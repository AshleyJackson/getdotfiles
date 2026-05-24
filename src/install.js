import { mkdir, writeFile, rename, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function backupFile(filePath) {
  const backupPath = `${filePath}.backup.${Date.now()}`;
  await rename(filePath, backupPath);
  return backupPath;
}

async function downloadFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

/**
 * Install a single dotfile to ~/{path}.
 * Returns { status, dest, backup }.
 */
export async function installFile(file, options = {}) {
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
    backup: backupPath,
  };
}