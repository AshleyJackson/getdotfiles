const GITHUB_API = "https://api.github.com";
const RAW_CONTENT = "https://raw.githubusercontent.com";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Get GitHub token: from env var or gh CLI.
 */
async function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], { shell: true });
    const token = stdout.trim();
    if (token) return token;
  } catch {
    // gh not installed or not authenticated
  }

  return null;
}

/**
 * Fetch repo contents from GitHub API.
 */
async function fetchContents(owner, repo, path, token) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "getdotfiles/1.0" };

  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });

  if (res.status === 404) {
    throw new Error(`Repo "${owner}/${repo}" not found.`);
  }
  if (res.status === 403) {
    const msg = token
      ? "Rate limit exceeded. Try again later."
      : "Rate limit exceeded. Set GITHUB_TOKEN env var or login with 'gh auth login'.";
    throw new Error(msg);
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Check if a filename qualifies as a dotfile.
 */
function isDotfile(name) {
  return name.startsWith(".");
}

/**
 * Recursively collect all dotfiles from a repo path.
 */
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
        download_url: item.download_url,
      });
    }
  }

  return files;
}

/**
 * List all dotfiles in a user's dotfiles repo.
 * Returns array of { path, name, download_url }.
 */
export async function listDotfilesRepo(owner, repoName = "dotfiles") {
  const token = await getToken();
  return collectDotfiles(owner, repoName, "", token);
}

/**
 * Get raw download URL for a specific path.
 */
export function getRawUrl(owner, repo, path) {
  return `${RAW_CONTENT}/${owner}/${repo}/main/${path}`;
}