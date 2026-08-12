import { access, mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { FetchFn } from "./github.ts";
import { resolveHomePath } from "./paths.ts";
import {
  DotfileSchema,
  InstallOptionsSchema,
  InstallResultSchema,
  type Dotfile,
  type InstallOptions,
  type InstallResult,
  type Platform,
} from "./schemas.ts";

/** Live file + this many timestamped backups (3 copies total). */
export const MAX_BACKUPS = 2;

export type InstallDeps = {
  fetch?: FetchFn;
  now?: () => number;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep only the newest `keep` `{file}.backup.{timestamp}` siblings.
 * Older backups are removed best-effort so install is not blocked.
 */
export async function pruneBackups(filePath: string, keep: number = MAX_BACKUPS): Promise<void> {
  const dir = dirname(filePath);
  const prefix = `${basename(filePath)}.backup.`;

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }

  const backups = names
    .filter((name) => name.startsWith(prefix))
    .map((name) => {
      const suffix = name.slice(prefix.length);
      const ts = /^\d+$/.test(suffix) ? Number(suffix) : Number.NaN;
      return { path: join(dir, name), ts };
    })
    .filter((backup) => Number.isFinite(backup.ts))
    .sort((a, b) => b.ts - a.ts);

  await Promise.all(
    backups.slice(keep).map(async (backup) => {
      try {
        await unlink(backup.path);
      } catch {
        // best-effort: leave orphan backup rather than failing install
      }
    }),
  );
}

async function backupFile(filePath: string, now: () => number): Promise<string> {
  const backupPath = `${filePath}.backup.${now()}`;
  await rename(filePath, backupPath);
  await pruneBackups(filePath);
  return backupPath;
}

/**
 * Download raw bytes so line endings and binary content are preserved.
 */
export async function downloadFile(url: string, fetchImpl: FetchFn = fetch): Promise<Buffer> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Install a single dotfile to ~/{path}.
 * Returns installed | backed-up | skipped (validated via Zod).
 */
export async function installFile(
  fileInput: Dotfile,
  optionsInput: InstallOptions = {},
  deps: InstallDeps = {},
): Promise<InstallResult> {
  const file = DotfileSchema.parse(fileInput);
  const options = InstallOptionsSchema.parse(optionsInput);
  const platform: Platform = options.platform ?? process.platform;
  const home = options.home;
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;

  const resolved = home
    ? resolveHomePath(file.path, home, platform)
    : resolveHomePath(file.path, undefined, platform);

  if (!resolved.ok) {
    return InstallResultSchema.parse({
      status: "skipped",
      dest: null,
      backup: null,
      reason: resolved.reason,
    });
  }

  const dest = resolved.dest;
  // Create every missing parent directory for nested paths
  // (e.g. ~/.config/nvim/lua/plugins/ for .../plugins/init.lua)
  await mkdir(dirname(dest), { recursive: true });

  const exists = await fileExists(dest);
  let backupPath: string | null = null;

  if (exists && !options.force) {
    backupPath = await backupFile(dest, now);
  }

  // Preserve repo bytes exactly (no LF/CRLF conversion)
  const content = await downloadFile(file.download_url, fetchImpl);
  await writeFile(dest, content);

  if (exists && !options.force) {
    return InstallResultSchema.parse({
      status: "backed-up",
      dest,
      backup: backupPath,
    });
  }

  return InstallResultSchema.parse({
    status: "installed",
    dest,
    backup: null,
  });
}
