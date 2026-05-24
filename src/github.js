const GITHUB_API = "https://api.github.com";
const RAW_CONTENT = "https://raw.githubusercontent.com";

/**
 * Fetch repo contents from GitHub API.
 */
async function fetchContents(owner, repo, path) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const headers = { Accept: "application/vnd.github+json" };

  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });

  if (res.status === 404) {
    throw new Error(`Repo "${owner}/${repo}" not found.`);
  }
  if (res.status === 403) {
    const msg = token
      ? "Rate limit exceeded. Try again later."
      : "Rate limit exceeded. Set GITHUB_TOKEN env var for higher limits.";
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
async function collectDotfiles(owner, repo, path = "") {
  const items = await fetchContents(owner, repo, path);
  const files = [];

  for (const item of items) {
    if (item.type === "dir") {
      // Recurse into subdirectories
      const nested = await collectDotfiles(owner, repo, item.path);
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
  return collectDotfiles(owner, repoName);
}

/**
 * Get raw download URL for a specific path.
 */
export function getRawUrl(owner, repo, path) {
  return `${RAW_CONTENT}/${owner}/${repo}/main/${path}`;
}