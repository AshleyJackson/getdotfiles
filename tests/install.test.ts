import { describe, expect, test } from "bun:test";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { downloadFile, installFile } from "../src/install.ts";
import type { Dotfile } from "../src/schemas.ts";
import { makeDotfile, textResponse, withTempDir } from "./helpers.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("downloadFile", () => {
  test("returns raw bytes including CRLF", async () => {
    const body = "line1\r\nline2\n";
    const buf = await downloadFile("https://example.com/f", async () => textResponse(body));
    expect(buf.equals(Buffer.from(body))).toBe(true);
  });

  test("preserves binary payloads", async () => {
    const bytes = Uint8Array.from([0, 1, 2, 255, 10, 13]);
    const buf = await downloadFile("https://example.com/bin", async () => textResponse(bytes));
    expect(buf.equals(Buffer.from(bytes))).toBe(true);
  });

  test("throws on non-OK response", async () => {
    await expect(
      downloadFile("https://example.com/missing", async () =>
        textResponse("nope", { status: 404, statusText: "Not Found" }),
      ),
    ).rejects.toThrow("404");
  });
});

describe("installFile", () => {
  test("writes a new file under home", async () => {
    await withTempDir(async (home) => {
      const result = await installFile(
        makeDotfile({ path: ".bashrc", name: ".bashrc" }),
        { home, platform: "linux" },
        {
          fetch: async () => textResponse("export HI=1\n"),
          now: () => 123,
        },
      );

      expect(result.status).toBe("installed");
      if (result.status !== "installed") throw new Error("expected installed");
      expect(result.dest).toBe(join(home, ".bashrc"));
      expect(await readFile(result.dest, "utf8")).toBe("export HI=1\n");
    });
  });

  test("creates nested directories", async () => {
    await withTempDir(async (home) => {
      const result = await installFile(
        makeDotfile({
          path: ".config/git/config",
          name: "config",
          download_url: "https://raw.githubusercontent.com/u/r/main/.config/git/config",
        }),
        { home, platform: "linux" },
        { fetch: async () => textResponse("[user]\n\tname = A\n") },
      );
      expect(result.status).toBe("installed");
      if (result.status !== "installed") throw new Error("expected installed");
      expect(await readFile(result.dest, "utf8")).toContain("name = A");
      // parents created all the way down
      expect(await exists(join(home, ".config"))).toBe(true);
      expect(await exists(join(home, ".config", "git"))).toBe(true);
    });
  });

  test("creates deep nested parents for subfolder files", async () => {
    await withTempDir(async (home) => {
      const rel = ".config/nvim/lua/plugins/init.lua";
      const result = await installFile(
        makeDotfile({
          path: rel,
          name: "init.lua",
          download_url: `https://raw.githubusercontent.com/u/r/main/${rel}`,
        }),
        { home, platform: "linux" },
        { fetch: async () => textResponse("return {}\n") },
      );
      expect(result.status).toBe("installed");
      if (result.status !== "installed") throw new Error("expected installed");
      expect(result.dest).toBe(join(home, ".config", "nvim", "lua", "plugins", "init.lua"));
      expect(await exists(join(home, ".config"))).toBe(true);
      expect(await exists(join(home, ".config", "nvim"))).toBe(true);
      expect(await exists(join(home, ".config", "nvim", "lua"))).toBe(true);
      expect(await exists(join(home, ".config", "nvim", "lua", "plugins"))).toBe(true);
      expect(await readFile(result.dest, "utf8")).toBe("return {}\n");
    });
  });

  test("backs up existing files when not forced", async () => {
    await withTempDir(async (home) => {
      const dest = join(home, ".gitconfig");
      await writeFile(dest, "old\n", "utf8");

      const result = await installFile(
        makeDotfile({ path: ".gitconfig", name: ".gitconfig" }),
        { home, force: false, platform: "linux" },
        {
          fetch: async () => textResponse("new\n"),
          now: () => 42,
        },
      );

      expect(result.status).toBe("backed-up");
      if (result.status !== "backed-up") throw new Error("expected backed-up");
      expect(result.backup).toBe(`${dest}.backup.42`);
      expect(await readFile(result.backup, "utf8")).toBe("old\n");
      expect(await readFile(dest, "utf8")).toBe("new\n");
    });
  });

  test("overwrites without backup when force=true", async () => {
    await withTempDir(async (home) => {
      const dest = join(home, ".gitconfig");
      await writeFile(dest, "old\n", "utf8");

      const result = await installFile(
        makeDotfile({ path: ".gitconfig", name: ".gitconfig" }),
        { home, force: true, platform: "linux" },
        {
          fetch: async () => textResponse("forced\n"),
          now: () => 99,
        },
      );

      expect(result.status).toBe("installed");
      expect(await exists(`${dest}.backup.99`)).toBe(false);
      expect(await readFile(dest, "utf8")).toBe("forced\n");
    });
  });

  test("skips invalid windows paths without writing", async () => {
    await withTempDir(async (home) => {
      let fetched = false;
      const result = await installFile(
        makeDotfile({ path: "bad:name", name: "bad:name" }),
        { home, platform: "win32" },
        {
          fetch: async () => {
            fetched = true;
            return textResponse("x");
          },
        },
      );

      expect(result).toEqual({
        status: "skipped",
        dest: null,
        backup: null,
        reason: 'invalid path segment on Windows: "bad:name"',
      });
      expect(fetched).toBe(false);
    });
  });

  test("skips reserved windows device segment", async () => {
    await withTempDir(async (home) => {
      const result = await installFile(
        makeDotfile({ path: ".config/NUL/settings", name: "settings" }),
        { home, platform: "win32" },
        { fetch: async () => textResponse("x") },
      );
      expect(result.status).toBe("skipped");
      if (result.status === "skipped") {
        expect(result.reason).toContain("NUL");
      }
    });
  });

  test("preserves CRLF bytes on write", async () => {
    await withTempDir(async (home) => {
      const payload = "a\r\nb\r\n";
      const result = await installFile(
        makeDotfile({ path: ".editorconfig", name: ".editorconfig" }),
        { home, platform: "linux" },
        { fetch: async () => textResponse(payload) },
      );
      expect(result.status).toBe("installed");
      if (result.status !== "installed") throw new Error("expected installed");
      const written = await readFile(result.dest);
      expect(written.equals(Buffer.from(payload))).toBe(true);
    });
  });

  test("rejects invalid Dotfile input via Zod", async () => {
    await expect(
      installFile(
        { path: ".x", name: ".x", download_url: "not-url" } as Dotfile,
        { home: "/tmp", platform: "linux" },
      ),
    ).rejects.toThrow();
  });

  test("propagates download failures", async () => {
    await withTempDir(async (home) => {
      await expect(
        installFile(
          makeDotfile(),
          { home, platform: "linux" },
          {
            fetch: async () => textResponse("missing", { status: 500, statusText: "ERR" }),
          },
        ),
      ).rejects.toThrow("Failed to download");
    });
  });
});
