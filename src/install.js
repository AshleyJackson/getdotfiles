import { mkdir, writeFile, rename, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();

/**
 * Check if a file exists.
 */
async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a backup of an existing file by renaming it.
 */
async function backupFile(filePath) {
  const backupPath = `${filePath}.backup.${Date.now()}`;
  await rename(filePath, backupPath);
  return backupPath;
}

/**
 * Download raw file content from URL.
 */
async function downloadFile(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Install dotfiles to home directory.
 *
 * @param {Array<{path: string, name: string, download_url: string}>} files
 * @param {{ force?: boolean }} options
 * @returns {Promise<Array<{status: string, dest: string, backup?: string}>>}
 */
export async function installDotfiles(files, options = {}) {
  const results = [];

  for (const file of files) {
    const dest = join(HOME, file.path);
    const destDir = dirname(dest);

    await mkdir(destDir, { recursive: true });

    const exists = await fileExists(dest);
    let backupPath = null;

    if (exists) {
      if (options.force) {
        // Overwrite without backup
      } else {
        backupPath = await backupFile(dest);
      }
    }

    const content = await downloadFile(file.download_url);
    await writeFile(dest, content, "utf-8");

    results.push({
      status: exists && !options.force ? "backed-up" : "installed",
      dest,
      backup: backupPath,
    });
  }

  return results;
}