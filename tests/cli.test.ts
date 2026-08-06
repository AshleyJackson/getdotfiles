import { describe, expect, test } from "bun:test";
import { confirm, parseArgs, USAGE } from "../src/cli.ts";

describe("parseArgs", () => {
  test("parses username only", () => {
    expect(parseArgs(["ashleyjackson"])).toEqual({
      username: "ashleyjackson",
      repo: "dotfiles",
      dryRun: false,
      force: false,
      yes: false,
      help: false,
    });
  });

  test("parses all flags", () => {
    expect(
      parseArgs(["me", "--repo", "my-configs", "--dry-run", "--force", "-y"]),
    ).toEqual({
      username: "me",
      repo: "my-configs",
      dryRun: true,
      force: true,
      yes: true,
      help: false,
    });
  });

  test("supports --yes long form", () => {
    expect(parseArgs(["u", "--yes"]).yes).toBe(true);
  });

  test("supports help flags", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["user", "-h"]).help).toBe(true);
  });

  test("username can appear after flags", () => {
    expect(parseArgs(["--dry-run", "someone"]).username).toBe("someone");
  });

  test("missing --repo value falls back to default", () => {
    expect(parseArgs(["u", "--repo"]).repo).toBe("dotfiles");
    expect(parseArgs(["u", "--repo", "--force"]).repo).toBe("dotfiles");
  });

  test("ignores unknown flags and extra positionals", () => {
    const opts = parseArgs(["first", "second", "--unknown"]);
    expect(opts.username).toBe("first");
  });

  test("empty argv yields null username", () => {
    expect(parseArgs([]).username).toBeNull();
  });

  test("USAGE documents core flags", () => {
    expect(USAGE).toContain("--dry-run");
    expect(USAGE).toContain("--force");
    expect(USAGE).toContain("-y");
    expect(USAGE).toContain("--repo");
  });
});

describe("confirm", () => {
  test("returns false immediately when not a TTY", async () => {
    const result = await confirm("ok? ", {
      isTTY: false,
      question: async () => {
        throw new Error("should not be called");
      },
    });
    expect(result).toBe(false);
  });

  test("accepts y / yes case-insensitively via injected question", async () => {
    expect(
      await confirm("ok? ", {
        isTTY: true,
        question: async () => true,
      }),
    ).toBe(true);
  });

  test("rejects other answers via injected question", async () => {
    expect(
      await confirm("ok? ", {
        isTTY: true,
        question: async () => false,
      }),
    ).toBe(false);
  });
});
