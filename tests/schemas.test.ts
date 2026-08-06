import { describe, expect, test } from "bun:test";
import { ZodError } from "zod";
import {
  CliOptionsSchema,
  DotfileListSchema,
  DotfileSchema,
  GitHubContentItemSchema,
  GitHubContentsResponseSchema,
  GitHubNameSchema,
  InstallOptionsSchema,
  InstallResultSchema,
  InstallSummarySchema,
  PathSplitResultSchema,
  ResolveHomeResultSchema,
} from "../src/schemas.ts";

describe("CliOptionsSchema", () => {
  test("accepts full options", () => {
    const parsed = CliOptionsSchema.parse({
      username: "ashleyjackson",
      repo: "dotfiles",
      dryRun: true,
      force: false,
      yes: true,
      help: false,
    });
    expect(parsed.username).toBe("ashleyjackson");
    expect(parsed.dryRun).toBe(true);
  });

  test("applies defaults", () => {
    const parsed = CliOptionsSchema.parse({ username: "u" });
    expect(parsed.repo).toBe("dotfiles");
    expect(parsed.dryRun).toBe(false);
    expect(parsed.force).toBe(false);
    expect(parsed.yes).toBe(false);
    expect(parsed.help).toBe(false);
  });

  test("allows null username", () => {
    expect(CliOptionsSchema.parse({ username: null }).username).toBeNull();
  });

  test("rejects empty username string", () => {
    expect(() => CliOptionsSchema.parse({ username: "" })).toThrow(ZodError);
  });
});

describe("DotfileSchema", () => {
  test("accepts valid dotfile", () => {
    const file = DotfileSchema.parse({
      path: ".config/git/config",
      name: "config",
      download_url: "https://raw.githubusercontent.com/a/b/main/.config/git/config",
    });
    expect(file.path).toBe(".config/git/config");
  });

  test("rejects non-url download_url", () => {
    expect(() =>
      DotfileSchema.parse({
        path: ".bashrc",
        name: ".bashrc",
        download_url: "not-a-url",
      }),
    ).toThrow(ZodError);
  });

  test("rejects missing fields", () => {
    expect(() => DotfileSchema.parse({ path: ".bashrc" })).toThrow(ZodError);
  });

  test("DotfileListSchema accepts arrays", () => {
    const list = DotfileListSchema.parse([
      {
        path: ".a",
        name: ".a",
        download_url: "https://example.com/a",
      },
    ]);
    expect(list).toHaveLength(1);
  });
});

describe("GitHubContentsResponseSchema", () => {
  test("accepts array of items", () => {
    const data = GitHubContentsResponseSchema.parse([
      {
        type: "file",
        name: ".bashrc",
        path: ".bashrc",
        download_url: "https://raw.githubusercontent.com/u/r/main/.bashrc",
      },
      {
        type: "dir",
        name: ".config",
        path: ".config",
        download_url: null,
      },
    ]);
    expect(Array.isArray(data)).toBe(true);
  });

  test("accepts single item object", () => {
    const data = GitHubContentsResponseSchema.parse({
      type: "file",
      name: ".gitconfig",
      path: ".gitconfig",
      download_url: "https://raw.githubusercontent.com/u/r/main/.gitconfig",
    });
    expect(Array.isArray(data)).toBe(false);
    if (Array.isArray(data)) throw new Error("expected single item");
    expect(data.type).toBe("file");
  });

  test("rejects unknown type", () => {
    expect(() =>
      GitHubContentItemSchema.parse({
        type: "blob",
        name: "x",
        path: "x",
      }),
    ).toThrow(ZodError);
  });
});

describe("InstallResultSchema", () => {
  test("installed requires null backup", () => {
    expect(
      InstallResultSchema.parse({
        status: "installed",
        dest: "/home/u/.bashrc",
        backup: null,
      }).status,
    ).toBe("installed");
  });

  test("backed-up requires backup path", () => {
    expect(
      InstallResultSchema.parse({
        status: "backed-up",
        dest: "/home/u/.bashrc",
        backup: "/home/u/.bashrc.backup.1",
      }).status,
    ).toBe("backed-up");
  });

  test("skipped requires reason and null paths", () => {
    const r = InstallResultSchema.parse({
      status: "skipped",
      dest: null,
      backup: null,
      reason: 'invalid path segment on Windows: "CON"',
    });
    expect(r.status).toBe("skipped");
    if (r.status !== "skipped") throw new Error("expected skipped");
    expect(r.reason).toContain("CON");
  });

  test("rejects mismatched shapes", () => {
    expect(() =>
      InstallResultSchema.parse({
        status: "installed",
        dest: "/x",
        backup: "/y",
      }),
    ).toThrow(ZodError);

    expect(() =>
      InstallResultSchema.parse({
        status: "skipped",
        dest: null,
        backup: null,
      }),
    ).toThrow(ZodError);
  });
});

describe("InstallOptionsSchema", () => {
  test("defaults force to false", () => {
    expect(InstallOptionsSchema.parse({}).force).toBe(false);
  });

  test("accepts home and platform", () => {
    const o = InstallOptionsSchema.parse({
      force: true,
      home: "C:\\Users\\me",
      platform: "win32",
    });
    expect(o.platform).toBe("win32");
    expect(o.home).toBe("C:\\Users\\me");
  });
});

describe("path result schemas", () => {
  test("PathSplitResultSchema ok/err", () => {
    expect(
      PathSplitResultSchema.parse({
        ok: true,
        segments: [".bashrc"],
        reason: null,
      }).ok,
    ).toBe(true);

    expect(
      PathSplitResultSchema.parse({
        ok: false,
        segments: [],
        reason: "empty path",
      }).ok,
    ).toBe(false);
  });

  test("ResolveHomeResultSchema ok/err", () => {
    expect(
      ResolveHomeResultSchema.parse({
        ok: true,
        dest: "/home/u/.bashrc",
        reason: null,
      }).dest,
    ).toBe("/home/u/.bashrc");

    expect(
      ResolveHomeResultSchema.parse({
        ok: false,
        dest: null,
        reason: "nope",
      }).ok,
    ).toBe(false);
  });
});

describe("InstallSummarySchema", () => {
  test("accepts non-negative ints", () => {
    expect(
      InstallSummarySchema.parse({ installed: 2, skipped: 1, failed: 0 }),
    ).toEqual({ installed: 2, skipped: 1, failed: 0 });
  });

  test("rejects negatives", () => {
    expect(() =>
      InstallSummarySchema.parse({ installed: -1, skipped: 0, failed: 0 }),
    ).toThrow(ZodError);
  });
});

describe("GitHubNameSchema", () => {
  test("accepts typical usernames and orgs", () => {
    expect(GitHubNameSchema.parse("ashleyjackson")).toBe("ashleyjackson");
    expect(GitHubNameSchema.parse("a")).toBe("a");
    expect(GitHubNameSchema.parse("my-org")).toBe("my-org");
  });

  test("rejects empty", () => {
    expect(() => GitHubNameSchema.parse("")).toThrow(ZodError);
  });
});
