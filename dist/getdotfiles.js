#!/usr/bin/env node

// src/github.js
var GITHUB_API = "https://api.github.com";
async function fetchContents(owner, repo, path) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const headers = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token)
    headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) {
    throw new Error(`Repo "${owner}/${repo}" not found.`);
  }
  if (res.status === 403) {
    const msg = token ? "Rate limit exceeded. Try again later." : "Rate limit exceeded. Set GITHUB_TOKEN env var for higher limits.";
    throw new Error(msg);
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
function isDotfile(name) {
  return name.startsWith(".");
}
async function collectDotfiles(owner, repo, path = "") {
  const items = await fetchContents(owner, repo, path);
  const files = [];
  for (const item of items) {
    if (item.type === "dir") {
      const nested = await collectDotfiles(owner, repo, item.path);
      files.push(...nested);
    } else if (item.type === "file" && isDotfile(item.name)) {
      files.push({
        path: item.path,
        name: item.name,
        download_url: item.download_url
      });
    }
  }
  return files;
}
async function listDotfilesRepo(owner, repoName = "dotfiles") {
  return collectDotfiles(owner, repoName);
}

// src/install.js
import { mkdir, writeFile, rename, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
var HOME = homedir();
async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function backupFile(filePath) {
  const backupPath = `${filePath}.backup.${Date.now()}`;
  await rename(filePath, backupPath);
  return backupPath;
}
async function downloadFile(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}
async function installDotfiles(files, options = {}) {
  const results = [];
  for (const file of files) {
    const dest = join(HOME, file.path);
    const destDir = dirname(dest);
    await mkdir(destDir, { recursive: true });
    const exists = await fileExists(dest);
    let backupPath = null;
    if (exists) {
      if (options.force) {} else {
        backupPath = await backupFile(dest);
      }
    }
    const content = await downloadFile(file.download_url);
    await writeFile(dest, content, "utf-8");
    results.push({
      status: exists && !options.force ? "backed-up" : "installed",
      dest,
      backup: backupPath
    });
  }
  return results;
}

// src/main.js
var USAGE = `
Usage:
  npx getdotfiles <username>                Fetch dotfiles from github.com/<username>/dotfiles
  npx getdotfiles <username> --repo <name>  Use a custom repo name
  npx getdotfiles <username> --dry-run      Preview files that would be installed
  npx getdotfiles <username> --force        Overwrite existing files without backup

Examples:
  npx getdotfiles ashleyjackson
  npx getdotfiles ashleyjackson --repo my-configs
  npx getdotfiles ashleyjackson --dry-run
`;
function parseArgs(args) {
  const opts = {
    username: null,
    repo: "dotfiles",
    dryRun: false,
    force: false
  };
  for (let i = 0;i < args.length; i++) {
    switch (args[i]) {
      case "--repo":
        opts.repo = args[++i] || "dotfiles";
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--force":
        opts.force = true;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
      default:
        if (!opts.username) {
          opts.username = args[i];
        }
    }
  }
  return opts;
}
async function main(argv) {
  const opts = parseArgs(argv);
  if (!opts.username) {
    console.error(USAGE);
    process.exit(1);
  }
  try {
    console.error(`Fetching dotfiles from ${opts.username}/${opts.repo}...`);
    const files = await listDotfilesRepo(opts.username, opts.repo);
    if (files.length === 0) {
      console.error("No dotfiles found in this repo.");
      process.exit(0);
    }
    if (opts.dryRun) {
      console.error(`
Would install ${files.length} file(s) to ~/:
`);
      for (const f of files) {
        console.log(`  ~/${f.path}`);
      }
      console.error(`
Use --force to overwrite existing files without backup.`);
      process.exit(0);
    }
    console.error(`Installing ${files.length} file(s) to ~/...
`);
    const results = await installDotfiles(files, { force: opts.force });
    for (const r of results) {
      const label = r.status === "backed-up" ? "⚠" : "✓";
      console.log(`  ${label} ~/${r.dest.replace(process.env.HOME || "~", "~")}`);
      if (r.backup) {
        console.log(`       backup: ${r.backup.replace(process.env.HOME || "~", "~")}`);
      }
    }
    console.error(`
Done.`);
  } catch (err) {
    console.error(`
Error: ${err.message}`);
    process.exit(1);
  }
}

// bin/getdotfiles.js
main(process.argv.slice(2));
