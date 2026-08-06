import { describe, expect, test } from "bun:test";
import {
  displayPath,
  isValidWindowsSegment,
  resolveHomePath,
  splitRepoPath,
  validateRepoPath,
} from "../src/paths.ts";

describe("splitRepoPath", () => {
  test("splits nested forward-slash paths", () => {
    expect(splitRepoPath(".config/nvim/init.lua")).toEqual({
      ok: true,
      segments: [".config", "nvim", "init.lua"],
      reason: null,
    });
  });

  test("normalizes backslashes to segments", () => {
    expect(splitRepoPath(".config\\git\\config")).toEqual({
      ok: true,
      segments: [".config", "git", "config"],
      reason: null,
    });
  });

  test("trims empty segments from duplicate slashes", () => {
    expect(splitRepoPath(".config//nvim///init.lua").segments).toEqual([
      ".config",
      "nvim",
      "init.lua",
    ]);
  });

  test("rejects empty and whitespace-only paths", () => {
    expect(splitRepoPath("").ok).toBe(false);
    expect(splitRepoPath("   ").ok).toBe(false);
    expect(splitRepoPath("/").ok).toBe(false);
  });

  test("rejects absolute unix paths", () => {
    expect(splitRepoPath("/etc/passwd").reason).toBe("absolute paths are not allowed");
  });

  test("rejects windows drive and UNC paths", () => {
    expect(splitRepoPath("C:\\Windows\\system.ini").ok).toBe(false);
    expect(splitRepoPath("c:/Windows/system.ini").ok).toBe(false);
    expect(splitRepoPath("\\\\server\\share\\file").ok).toBe(false);
    expect(splitRepoPath("//server/share/file").ok).toBe(false);
  });

  test("rejects path traversal", () => {
    expect(splitRepoPath("../.bashrc").ok).toBe(false);
    expect(splitRepoPath(".config/../.bashrc").ok).toBe(false);
    expect(splitRepoPath(".config/./secret").ok).toBe(false);
    expect(splitRepoPath("..").reason).toBe("path traversal is not allowed");
  });

  test("accepts leading-dot file at root", () => {
    expect(splitRepoPath(".bashrc")).toEqual({
      ok: true,
      segments: [".bashrc"],
      reason: null,
    });
  });
});

describe("isValidWindowsSegment", () => {
  test("allows normal and leading-dot names", () => {
    expect(isValidWindowsSegment(".bashrc")).toBe(true);
    expect(isValidWindowsSegment("init.lua")).toBe(true);
    expect(isValidWindowsSegment(".gitconfig")).toBe(true);
    expect(isValidWindowsSegment("nvim")).toBe(true);
  });

  test("rejects reserved device names", () => {
    for (const name of ["CON", "con", "PRN", "AUX", "NUL", "nul.txt", "COM1", "LPT9", "com3.log"]) {
      expect(isValidWindowsSegment(name)).toBe(false);
    }
  });

  test("rejects illegal characters", () => {
    for (const name of ["bad:name", "foo*bar", "a?b", "x|y", "a<b", "a>b", "a\"b"]) {
      expect(isValidWindowsSegment(name)).toBe(false);
    }
  });

  test("rejects trailing dots and spaces", () => {
    expect(isValidWindowsSegment("ends-with-dot.")).toBe(false);
    expect(isValidWindowsSegment("ends-with-space ")).toBe(false);
  });

  test("rejects empty segment", () => {
    expect(isValidWindowsSegment("")).toBe(false);
  });
});

describe("validateRepoPath", () => {
  test("accepts typical dotfile paths on Windows", () => {
    expect(validateRepoPath(".gitconfig", "win32").ok).toBe(true);
    expect(validateRepoPath(".config/git/config", "win32").ok).toBe(true);
    expect(validateRepoPath(".ssh/config", "win32").ok).toBe(true);
  });

  test("rejects invalid Windows segments only on win32", () => {
    expect(validateRepoPath("foo:bar", "win32").ok).toBe(false);
    expect(validateRepoPath("foo:bar", "linux").ok).toBe(true);
    expect(validateRepoPath("foo:bar", "darwin").ok).toBe(true);
    expect(validateRepoPath("dir/CON/file", "win32").ok).toBe(false);
    expect(validateRepoPath("dir/CON/file", "linux").ok).toBe(true);
  });

  test("includes offending segment in reason", () => {
    const r = validateRepoPath(".config/NUL/settings", "win32");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("NUL");
  });
});

describe("resolveHomePath", () => {
  test("joins under the provided home directory on posix", () => {
    const r = resolveHomePath(".config/nvim/init.lua", "/home/user", "linux");
    expect(r).toEqual({
      ok: true,
      reason: null,
      dest: "/home/user/.config/nvim/init.lua",
    });
  });

  test("fails closed on bad paths", () => {
    expect(resolveHomePath("../x", "/home/user", "linux").ok).toBe(false);
    expect(resolveHomePath("", "/home/user", "linux").ok).toBe(false);
  });

  test("propagates windows validation failures", () => {
    const r = resolveHomePath("bad:name", "C:\\Users\\me", "win32");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.dest).toBeNull();
  });
});

describe("displayPath", () => {
  test("replaces home with ~ and normalizes slashes on posix", () => {
    expect(displayPath("/home/user/.bashrc", "/home/user", "linux")).toBe("~/.bashrc");
    expect(displayPath("/home/user/.config/a", "/home/user", "linux")).toBe("~/.config/a");
  });

  test("leaves paths outside home unchanged (aside from slashes)", () => {
    expect(displayPath("/tmp/file", "/home/user", "linux")).toBe("/tmp/file");
  });

  test("case-insensitive home match on Windows", () => {
    expect(displayPath("C:\\Users\\Foo\\.bashrc", "C:\\Users\\foo", "win32")).toBe("~/.bashrc");
    expect(
      displayPath("C:\\Users\\Foo\\.config\\git\\config", "C:\\Users\\Foo", "win32"),
    ).toBe("~/.config/git/config");
  });

  test("handles nullish input", () => {
    expect(displayPath(null)).toBe("");
    expect(displayPath(undefined)).toBe("");
    expect(displayPath("")).toBe("");
  });
});
