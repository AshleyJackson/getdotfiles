import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

async function backupFile(filePath: string, now: () => number): Promise<string> {
  const backupPath = `${filePath}.backup.${now()}`;
  await rename(filePath, backupPath);
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
