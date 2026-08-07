import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  DotfileListSchema,
  DotfileSchema,
  GitHubContentsResponseSchema,
  GitHubNameSchema,
  type Dotfile,
  type DotfileList,
  type GitHubContentItem,
  type Platform,
} from "./schemas.ts";

const GITHUB_API = "https://api.github.com";
const RAW_CONTENT = "https://raw.githubusercontent.com";

const execFileAsync = promisify(execFile);

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: {
    shell?: boolean | string;
    windowsHide?: boolean;
  },
) => Promise<{ stdout: string; stderr: string }>;

/** Minimal fetch surface so tests can inject plain functions. */
export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type GithubDeps = {
  fetch?: FetchFn;
  execFile?: ExecFileFn;
  env?: NodeJS.ProcessEnv;
  platform?: Platform;
};

export type GhInvocation = {
  command: string;
  args: string[];
  options: { shell?: boolean; windowsHide?: boolean };
};

/**
 * Candidate ways to invoke the GitHub CLI across platforms.
 *
 * Windows note (Node ≥18.20.2 / ≥20.12.2, CVE-2024-27980): spawning a `.cmd` /
 * `.bat` *without* `shell: true` fails with `Error: spawn EINVAL`. Prefer the
 * real `gh.exe`, and only use `.cmd` via a shell.
 */
export function ghTokenInvocations(platform: Platform = process.platform): GhInvocation[] {
  if (platform === "win32") {
    return [
      { command: "gh.exe", args: ["auth", "token"], options: { windowsHide: true } },
      { command: "gh", args: ["auth", "token"], options: { windowsHide: true } },
      // .cmd batch shim — must use shell:true or Node throws spawn EINVAL
      { command: "gh.cmd", args: ["auth", "token"], options: { shell: true, windowsHide: true } },
      { command: "gh", args: ["auth", "token"], options: { shell: true, windowsHide: true } },
    ];
  }

  return [{ command: "gh", args: ["auth", "token"], options: {} }];
}

/**
 * Interactive `gh` invocations (e.g. `gh auth login`) with stdio inherit.
 * Same Windows shell rules as {@link ghTokenInvocations}.
 */
export function ghInteractiveInvocations(
  platform: Platform = process.platform,
  args: readonly string[] = ["auth", "login"],
): GhInvocation[] {
  if (platform === "win32") {
    return [
      { command: "gh.exe", args: [...args], options: { windowsHide: false } },
      { command: "gh", args: [...args], options: { windowsHide: false } },
      // cmd.exe /c keeps a real console for the interactive login flow
      {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", "gh", ...args],
        options: { windowsHide: false },
      },
      {
        command: "gh.cmd",
        args: [...args],
        options: { shell: true, windowsHide: false },
      },
      {
        command: "gh",
        args: [...args],
        options: { shell: true, windowsHide: false },
      },
    ];
  }

  return [{ command: "gh", args: [...args], options: {} }];
}

/**
 * Get GitHub token: from env var or gh CLI.
 */
export async function getToken(deps: GithubDeps = {}): Promise<string | null> {
  const env = deps.env ?? process.env;
  if (env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim()) {
    return env.GITHUB_TOKEN.trim();
  }

  const run = deps.execFile ?? defaultExecFile;
  const platform = deps.platform ?? process.platform;

  for (const { command, args, options } of ghTokenInvocations(platform)) {
    try {
      const { stdout } = await run(command, args, options);
      const token = stdout.trim();
      if (token) return token;
    } catch {
      // try next candidate
    }
  }

  return null;
}

async function defaultExecFile(
  file: string,
  args: readonly string[],
  options?: { shell?: boolean | string; windowsHide?: boolean },
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, [...args], options);
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

/**
 * Fetch repo contents from GitHub API and validate with Zod.
 */
export async function fetchContents(
  owner: string,
  repo: string,
  path: string,
  token: string | null,
  deps: GithubDeps = {},
): Promise<GitHubContentItem[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "getdotfiles/1.0",
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchImpl(url, { headers });

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

  const json: unknown = await res.json();
  const parsed = GitHubContentsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Unexpected GitHub API response shape: ${parsed.error.message}`);
  }

  return Array.isArray(parsed.data) ? parsed.data : [parsed.data];
}

/**
 * Check if a filename starts with a dot (legacy helper; collection no longer
 * filters to these only).
 */
export function isDotfile(name: string): boolean {
  return name.startsWith(".");
}

/**
 * True when any path segment is a dot-segment (`.config`, `.ssh`, …).
 */
export function isUnderDotPath(repoPath: string): boolean {
  return repoPath
    .split(/[/\\]+/)
    .filter(Boolean)
    .some((segment) => segment.startsWith("."));
}

/** Directories never traversed when collecting installable files. */
const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".svn",
  ".hg",
]);

/**
 * Recursively collect **all** installable files from a repo (not only `.*`).
 *
 * - Every file at any depth is included when it has a `download_url`
 * - Every directory is recursed except VCS/vendor noise (`.git`, `node_modules`, …)
 * - Destination paths stay repo-relative under the user home
 *   (e.g. `Documents/WindowsPowerShell/profile.ps1` → `~/Documents/...`)
 */
export async function collectDotfiles(
  owner: string,
  repo: string,
  path = "",
  token: string | null = null,
  deps: GithubDeps = {},
): Promise<DotfileList> {
  const items = await fetchContents(owner, repo, path, token, deps);
  const files: Dotfile[] = [];

  for (const item of items) {
    if (item.type === "dir") {
      if (SKIP_DIR_NAMES.has(item.name.toLowerCase()) || SKIP_DIR_NAMES.has(item.name)) {
        continue;
      }
      const child = await collectDotfiles(owner, repo, item.path, token, deps);
      files.push(...child);
      continue;
    }

    if (item.type !== "file") continue;
    if (!item.download_url) {
      // Skip files without a downloadable URL (e.g. git-lfs placeholders)
      continue;
    }

    const file = DotfileSchema.safeParse({
      path: item.path,
      name: item.name,
      download_url: item.download_url,
    });
    if (file.success) {
      files.push(file.data);
    }
  }

  return DotfileListSchema.parse(files);
}

/**
 * List all dotfiles in a user's dotfiles repo.
 */
export async function listDotfilesRepo(
  owner: string,
  repoName = "dotfiles",
  deps: GithubDeps = {},
): Promise<DotfileList> {
  const ownerParsed = GitHubNameSchema.safeParse(owner);
  if (!ownerParsed.success) {
    throw new Error(`Invalid GitHub username: ${owner}`);
  }
  const repoParsed = z.string().min(1).max(100).safeParse(repoName);
  if (!repoParsed.success) {
    throw new Error(`Invalid repository name: ${repoName}`);
  }

  const token = await getToken(deps);
  return collectDotfiles(ownerParsed.data, repoParsed.data, "", token, deps);
}

/**
 * Get raw download URL for a specific path (default branch name assumed: main).
 */
export function getRawUrl(owner: string, repo: string, path: string): string {
  return `${RAW_CONTENT}/${owner}/${repo}/main/${path}`;
}
