import { homedir } from "node:os";
import { join } from "node:path";
import {
  PathSplitResultSchema,
  ResolveHomeResultSchema,
  type PathSplitResult,
  type Platform,
  type ResolveHomeResult,
} from "./schemas.ts";

/** Characters illegal in Windows file/directory names. */
const WIN_INVALID_CHARS = /[<>:"|?*\x00-\x1f]/;

/** Windows reserved device names (with or without extension). */
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;

/**
 * Split a repo-relative path into safe segments.
 * GitHub paths use forward slashes; reject empty / traversal segments.
 */
export function splitRepoPath(repoPath: string): PathSplitResult {
  if (typeof repoPath !== "string" || !repoPath.trim()) {
    return PathSplitResultSchema.parse({
      ok: false,
      reason: "empty path",
      segments: [],
    });
  }

  // Reject absolute paths (Unix or Windows drive/UNC)
  if (
    repoPath.startsWith("/") ||
    repoPath.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/.test(repoPath) ||
    repoPath.startsWith("//") ||
    repoPath.startsWith("\\\\")
  ) {
    return PathSplitResultSchema.parse({
      ok: false,
      reason: "absolute paths are not allowed",
      segments: [],
    });
  }

  const segments = repoPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s.length > 0);

  if (segments.length === 0) {
    return PathSplitResultSchema.parse({
      ok: false,
      reason: "empty path",
      segments: [],
    });
  }

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return PathSplitResultSchema.parse({
        ok: false,
        reason: "path traversal is not allowed",
        segments: [],
      });
    }
  }

  return PathSplitResultSchema.parse({
    ok: true,
    segments,
    reason: null,
  });
}

/**
 * Whether a single path segment is valid on Windows.
 */
export function isValidWindowsSegment(segment: string): boolean {
  if (!segment) return false;
  if (WIN_INVALID_CHARS.test(segment)) return false;
  // Windows does not allow trailing dots or spaces
  if (/[. ]$/.test(segment)) return false;
  if (WIN_RESERVED.test(segment)) return false;
  return true;
}

/**
 * Validate repo path segments for the given platform.
 * On non-Windows, only traversal/absolute checks from splitRepoPath apply.
 */
export function validateRepoPath(
  repoPath: string,
  platform: Platform = process.platform,
): PathSplitResult {
  const split = splitRepoPath(repoPath);
  if (!split.ok) return split;

  if (platform === "win32") {
    for (const segment of split.segments) {
      if (!isValidWindowsSegment(segment)) {
        return PathSplitResultSchema.parse({
          ok: false,
          reason: `invalid path segment on Windows: "${segment}"`,
          segments: split.segments,
        });
      }
    }
  }

  return PathSplitResultSchema.parse({
    ok: true,
    segments: split.segments,
    reason: null,
  });
}

/**
 * Resolve a repo-relative path under the user home directory.
 */
export function resolveHomePath(
  repoPath: string,
  home: string = homedir(),
  platform: Platform = process.platform,
): ResolveHomeResult {
  const validated = validateRepoPath(repoPath, platform);
  if (!validated.ok) {
    return ResolveHomeResultSchema.parse({
      ok: false,
      reason: validated.reason,
      dest: null,
    });
  }
  return ResolveHomeResultSchema.parse({
    ok: true,
    reason: null,
    dest: join(home, ...validated.segments),
  });
}

/**
 * Pretty-print a filesystem path with ~ for the home directory.
 * Case-insensitive home prefix match on Windows; always display with /.
 */
export function displayPath(
  filePath: string | null | undefined,
  home: string = homedir(),
  platform: Platform = process.platform,
): string {
  if (!filePath) return filePath ?? "";

  let result = filePath;
  if (platform === "win32") {
    const homeLower = home.toLowerCase();
    const pathLower = filePath.toLowerCase();
    if (pathLower.startsWith(homeLower)) {
      result = `~${filePath.slice(home.length)}`;
    }
  } else if (filePath.startsWith(home)) {
    result = `~${filePath.slice(home.length)}`;
  }

  return result.replace(/\\/g, "/");
}
