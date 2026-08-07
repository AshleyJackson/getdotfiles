import { describe, expect, test } from "bun:test";
import { installAll, main } from "../src/main.ts";
import type { Dotfile, InstallResult } from "../src/schemas.ts";
import { ExitError, captureIo, makeDotfile } from "./helpers.ts";

function files(...paths: string[]): Dotfile[] {
  return paths.map((path) =>
    makeDotfile({
      path,
      name: path.split("/").pop() ?? path,
    }),
  );
}

async function runMain(
  argv: readonly string[],
  deps: Parameters<typeof main>[1] = {},
): Promise<number> {
  try {
    await main(argv, {
      // Avoid probing the real host for gh during unit tests
      ensureGh: async () => ({ status: "already-installed" }),
      ...deps,
    });
    return 0;
  } catch (err) {
    if (err instanceof ExitError) return err.code;
    throw err;
  }
}

describe("installAll", () => {
  test("counts installed / skipped / failed", async () => {
    const io = captureIo();
    const summary = await installAll(
      files(".ok", ".skip-me", ".boom"),
      { force: false, home: "/home/u", platform: "linux" },
      {
        ...io,
        install: async (file): Promise<InstallResult> => {
          if (file.path === ".ok") {
            return { status: "installed", dest: "/home/u/.ok", backup: null };
          }
          if (file.path === ".skip-me") {
            return {
              status: "skipped",
              dest: null,
              backup: null,
              reason: 'invalid path segment on Windows: "skip-me"',
            };
          }
          throw new Error("network down");
        },
      },
    );

    expect(summary).toEqual({ installed: 1, skipped: 1, failed: 1 });
    expect(io.logs.some((l) => l.includes("✓") && l.includes("~/.ok"))).toBe(true);
    expect(io.errors.some((e) => e.includes("skipped") && e.includes(".skip-me"))).toBe(true);
    expect(io.errors.some((e) => e.includes("✗") && e.includes("network down"))).toBe(true);
  });

  test("prints backup path when backed up", async () => {
    const io = captureIo();
    await installAll(files(".bashrc"), { force: false, home: "/home/u", platform: "linux" }, {
      ...io,
      install: async () => ({
        status: "backed-up",
        dest: "/home/u/.bashrc",
        backup: "/home/u/.bashrc.backup.1",
      }),
    });
    expect(io.logs.some((l) => l.includes("backup:") && l.includes("~/.bashrc.backup.1"))).toBe(
      true,
    );
  });
});

describe("main", () => {
  test("prints usage and exits 1 without username", async () => {
    const io = captureIo();
    const code = await runMain([], io);
    expect(code).toBe(1);
    expect(io.errors.join("\n")).toContain("Usage:");
  });

  test("help flag prints usage and exits 0", async () => {
    const io = captureIo();
    const code = await runMain(["--help"], io);
    expect(code).toBe(0);
    expect(io.logs.join("\n")).toContain("Usage:");
  });

  test("dry-run lists files and exits 0 without installing", async () => {
    const io = captureIo();
    let installed = false;
    const code = await runMain(["user", "--dry-run"], {
      ...io,
      listDotfiles: async () => files(".bashrc", ".gitconfig"),
      install: async () => {
        installed = true;
        return { status: "installed", dest: "/x", backup: null };
      },
    });
    expect(code).toBe(0);
    expect(installed).toBe(false);
    expect(io.errors.join("\n")).toContain("Found 2 file(s)");
    expect(io.errors.join("\n")).toContain("~/.bashrc");
  });

  test("exits 0 when repo has no dotfiles", async () => {
    const io = captureIo();
    const code = await runMain(["user"], {
      ...io,
      listDotfiles: async () => [],
    });
    expect(code).toBe(0);
    expect(io.errors.join("\n")).toContain("No dotfiles found");
  });

  test("aborts when user declines confirmation", async () => {
    const io = captureIo();
    const code = await runMain(["user"], {
      ...io,
      isTTY: true,
      listDotfiles: async () => files(".bashrc"),
      confirm: async () => false,
    });
    expect(code).toBe(1);
    expect(io.errors.join("\n")).toContain("Aborted.");
  });

  test("aborts without TTY when -y not set", async () => {
    const io = captureIo();
    const code = await runMain(["user"], {
      ...io,
      isTTY: false,
      listDotfiles: async () => files(".bashrc"),
      confirm: async (_msg, opts) => {
        if (opts?.isTTY === false) return false;
        return true;
      },
    });
    expect(code).toBe(1);
    expect(io.errors.join("\n")).toContain("Aborted.");
  });

  test("-y installs without confirm", async () => {
    const io = captureIo();
    const seen: string[] = [];
    const code = await runMain(["user", "-y"], {
      ...io,
      home: "/home/u",
      platform: "linux",
      listDotfiles: async () => files(".bashrc", ".bad"),
      confirm: async () => {
        throw new Error("confirm should not run");
      },
      install: async (file): Promise<InstallResult> => {
        seen.push(file.path);
        if (file.path === ".bad") {
          return {
            status: "skipped",
            dest: null,
            backup: null,
            reason: "invalid",
          };
        }
        return { status: "installed", dest: `/home/u/${file.path}`, backup: null };
      },
    });
    expect(code).toBe(0);
    expect(seen).toEqual([".bashrc", ".bad"]);
    expect(io.errors.join("\n")).toContain("1 installed, 1 skipped, 0 failed");
  });

  test("exits 1 when any install throws", async () => {
    const io = captureIo();
    const code = await runMain(["user", "-y"], {
      ...io,
      listDotfiles: async () => files(".bashrc"),
      install: async () => {
        throw new Error("disk full");
      },
    });
    expect(code).toBe(1);
    expect(io.errors.join("\n")).toContain("disk full");
  });

  test("exits 1 when everything is skipped", async () => {
    const io = captureIo();
    const code = await runMain(["user", "-y"], {
      ...io,
      listDotfiles: async () => files("CON"),
      install: async () => ({
        status: "skipped",
        dest: null,
        backup: null,
        reason: 'invalid path segment on Windows: "CON"',
      }),
    });
    expect(code).toBe(1);
  });

  test("fatal list errors exit 1 with message", async () => {
    const io = captureIo();
    const code = await runMain(["user", "-y"], {
      ...io,
      listDotfiles: async () => {
        throw new Error('Repo "user/dotfiles" not found.');
      },
    });
    expect(code).toBe(1);
    expect(io.errors.join("\n")).toContain("not found");
  });

  test("passes custom repo name through", async () => {
    const io = captureIo();
    let seenRepo = "";
    const code = await runMain(["alice", "--repo", "my-configs", "--dry-run"], {
      ...io,
      listDotfiles: async (_owner, repo = "dotfiles") => {
        seenRepo = repo;
        return files(".zshrc");
      },
    });
    expect(code).toBe(0);
    expect(seenRepo).toBe("my-configs");
  });

  test("invokes ensureGh before listing", async () => {
    const io = captureIo();
    const order: string[] = [];
    const code = await runMain(["user", "--dry-run"], {
      ...io,
      ensureGh: async () => {
        order.push("ensureGh");
        return { status: "already-installed" };
      },
      listDotfiles: async () => {
        order.push("list");
        return files(".bashrc");
      },
    });
    expect(code).toBe(0);
    expect(order).toEqual(["ensureGh", "list"]);
  });
});
