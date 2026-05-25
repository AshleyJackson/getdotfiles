#!/usr/bin/env node

// src/main.js
import { createInterface } from "node:readline";

// src/github.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var GITHUB_API = "https://api.github.com";
var execFileAsync = promisify(execFile);
async function getToken() {
  if (process.env.GITHUB_TOKEN)
    return process.env.GITHUB_TOKEN;
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"]);
    const token = stdout.trim();
    if (token)
      return token;
  } catch {}
  return null;
}
async function fetchContents(owner, repo, path, token) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "getdotfiles/1.0" };
  if (token)
    headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) {
    throw new Error(`Repo "${owner}/${repo}" not found.`);
  }
  if (res.status === 403) {
    const msg = token ? "Rate limit exceeded. Try again later." : "Rate limit exceeded. Set GITHUB_TOKEN env var or login with 'gh auth login'.";
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
async function collectDotfiles(owner, repo, path = "", token) {
  const items = await fetchContents(owner, repo, path, token);
  const files = [];
  for (const item of items) {
    if (item.type === "dir") {
      const nested = await collectDotfiles(owner, repo, item.path, token);
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
  const token = await getToken();
  return collectDotfiles(owner, repoName, "", token);
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
  if (!res.ok)
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}
async function installFile(file, options = {}) {
  const dest = join(HOME, file.path);
  await mkdir(dirname(dest), { recursive: true });
  const exists = await fileExists(dest);
  let backupPath = null;
  if (exists && !options.force) {
    backupPath = await backupFile(dest);
  }
  const content = await downloadFile(file.download_url);
  await writeFile(dest, content, "utf-8");
  return {
    status: exists && !options.force ? "backed-up" : "installed",
    dest,
    backup: backupPath
  };
}

// src/main.js
import { homedir as homedir2 } from "node:os";
var HOME2 = homedir2();
var USAGE = `
Usage:
  npx getdotfiles <username>                Fetch dotfiles from github.com/<username>/dotfiles
  npx getdotfiles <username> --repo <name>  Use a custom repo name
  npx getdotfiles <username> --dry-run      Preview files that would be installed
  npx getdotfiles <username> --force        Overwrite existing files without backup
  npx getdotfiles <username> -y             Skip confirmation prompt

Examples:
  npx getdotfiles ashleyjackson
  npx getdotfiles ashleyjackson --repo my-configs
  npx getdotfiles ashleyjackson --dry-run
`;
function parseArgs(args) {
  const opts = { username: null, repo: "dotfiles", dryRun: false, force: false, yes: false };
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
      case "-y":
      case "--yes":
        opts.yes = true;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
      default:
        if (!opts.username)
          opts.username = args[i];
    }
  }
  return opts;
}
async function confirm(msg) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(msg, (a) => {
      rl.close();
      resolve(a.toLowerCase() === "y" || a.toLowerCase() === "yes");
    });
  });
}
async function main(argv) {
  const opts = parseArgs(argv);
  if (!opts.username) {
    console.error(USAGE);
    process.exit(1);
  }
  try {
    const files = await listDotfilesRepo(opts.username, opts.repo);
    if (files.length === 0) {
      console.error("No dotfiles found in this repo.");
      process.exit(0);
    }
    console.error(`
Found ${files.length} file(s) in ${opts.username}/${opts.repo}:
`);
    for (const f of files)
      console.error(`  ~/${f.path}`);
    console.error("");
    if (opts.dryRun)
      process.exit(0);
    if (!opts.yes) {
      const ok = await confirm("Write these files to ~/? [y/N] ");
      console.error("");
      if (!ok) {
        console.error("Aborted.");
        process.exit(1);
      }
    }
    for (const file of files) {
      const r = await installFile(file, { force: opts.force });
      const label = r.status === "backed-up" ? "⚠" : "✓";
      console.log(`  ${label} ${r.dest.replace(HOME2, "~")}`);
      if (r.backup)
        console.log(`       backup: ${r.backup.replace(HOME2, "~")}`);
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
