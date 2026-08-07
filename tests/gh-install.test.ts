import { describe, expect, test } from "bun:test";
import {
  ensureGhAvailable,
  GH_INSTALL_DOCS,
  hasGithubToken,
  isGhInstalled,
  resolveGhInstallCommand,
  type GhInstallCommand,
} from "../src/gh-install.ts";
import { captureIo } from "./helpers.ts";

describe("hasGithubToken", () => {
  test("true for non-empty token", () => {
    expect(hasGithubToken({ GITHUB_TOKEN: "ghp_x" })).toBe(true);
    expect(hasGithubToken({ GITHUB_TOKEN: "  tok  " })).toBe(true);
  });

  test("false when missing or blank", () => {
    expect(hasGithubToken({})).toBe(false);
    expect(hasGithubToken({ GITHUB_TOKEN: "" })).toBe(false);
    expect(hasGithubToken({ GITHUB_TOKEN: "   " })).toBe(false);
  });
});

describe("isGhInstalled", () => {
  test("true when gh --version succeeds", async () => {
    const ok = await isGhInstalled({
      platform: "linux",
      execFile: async (cmd, args) => {
        expect(cmd).toBe("gh");
        expect(args).toEqual(["--version"]);
        return { stdout: "gh version 2.40.0 (2024-01-01)\n", stderr: "" };
      },
    });
    expect(ok).toBe(true);
  });

  test("false when all candidates fail", async () => {
    const ok = await isGhInstalled({
      platform: "win32",
      execFile: async () => {
        throw new Error("not found");
      },
    });
    expect(ok).toBe(false);
  });

  test("windows tries gh.cmd then succeeds on gh.exe", async () => {
    const tried: string[] = [];
    const ok = await isGhInstalled({
      platform: "win32",
      execFile: async (cmd) => {
        tried.push(cmd);
        if (cmd !== "gh.exe") throw new Error("nope");
        return { stdout: "gh version 2.0.0\n", stderr: "" };
      },
    });
    expect(ok).toBe(true);
    expect(tried).toEqual(["gh.cmd", "gh.exe"]);
  });
});

describe("resolveGhInstallCommand", () => {
  test("prefers brew on darwin when present", async () => {
    const recipe = await resolveGhInstallCommand("darwin", {}, {
      execFile: async (cmd) => {
        if (cmd === "which" || cmd === "brew") {
          // which brew
          return { stdout: "/opt/homebrew/bin/brew\n", stderr: "" };
        }
        throw new Error("missing");
      },
    });
    expect(recipe?.display).toBe("brew install gh");
    expect(recipe?.command).toBe("brew");
  });

  test("uses winget on windows when available", async () => {
    const recipe = await resolveGhInstallCommand("win32", {}, {
      execFile: async (cmd, args) => {
        if (cmd === "where.exe" && args[0] === "winget") {
          return { stdout: "C:\\winget.exe\n", stderr: "" };
        }
        throw new Error("missing");
      },
    });
    expect(recipe?.label).toBe("winget");
    expect(recipe?.args).toContain("GitHub.cli");
  });

  test("uses apt recipe on linux when apt-get exists", async () => {
    const recipe = await resolveGhInstallCommand("linux", {}, {
      execFile: async (cmd, args) => {
        if (cmd === "which" && args[0] === "apt-get") {
          return { stdout: "/usr/bin/apt-get\n", stderr: "" };
        }
        // brew / others missing
        throw new Error("missing");
      },
    });
    expect(recipe?.label).toContain("apt");
    expect(recipe?.command).toBe("bash");
  });

  test("returns null when no package manager found", async () => {
    const recipe = await resolveGhInstallCommand("linux", {}, {
      execFile: async () => {
        throw new Error("missing");
      },
    });
    expect(recipe).toBeNull();
  });
});

describe("ensureGhAvailable", () => {
  test("short-circuits when GITHUB_TOKEN is set", async () => {
    const io = captureIo();
    let probed = false;
    const result = await ensureGhAvailable({
      ...io,
      env: { GITHUB_TOKEN: "ghp_x" },
      execFile: async () => {
        probed = true;
        throw new Error("should not probe gh");
      },
    });
    expect(result).toEqual({ status: "token-present" });
    expect(probed).toBe(false);
  });

  test("returns already-installed when gh works", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable({
      ...io,
      env: {},
      platform: "linux",
      execFile: async () => ({ stdout: "gh version 2.0\n", stderr: "" }),
    });
    expect(result).toEqual({ status: "already-installed" });
  });

  test("non-interactive skips install offer", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable({
      ...io,
      env: {},
      platform: "linux",
      isTTY: false,
      execFile: async () => {
        throw new Error("no gh");
      },
    });
    expect(result).toEqual({ status: "skipped-non-interactive" });
    expect(io.errors.join("\n")).toContain("GitHub CLI (gh) was not found");
    expect(io.errors.join("\n")).toContain(GH_INSTALL_DOCS);
    expect(io.errors.join("\n")).toContain("Non-interactive");
  });

  test("TTY user declines install", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable({
      ...io,
      env: {},
      platform: "linux",
      isTTY: true,
      execFile: async () => {
        throw new Error("no gh");
      },
      resolveInstall: () => ({
        label: "Homebrew",
        command: "brew",
        args: ["install", "gh"],
        display: "brew install gh",
      }),
      confirm: async () => false,
    });
    expect(result).toEqual({ status: "skipped-by-user" });
    expect(io.errors.join("\n")).toContain("Skipping gh install");
  });

  test("TTY no recipe prints manual guidance", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable({
      ...io,
      env: {},
      platform: "linux",
      isTTY: true,
      execFile: async () => {
        throw new Error("no gh");
      },
      resolveInstall: () => null,
    });
    expect(result).toEqual({ status: "no-recipe" });
    expect(io.errors.join("\n")).toContain("No supported package manager");
  });

  test("install success then optional auth login", async () => {
    const io = captureIo();
    const prompts: string[] = [];
    let installed = false;
    const recipe: GhInstallCommand = {
      label: "Homebrew",
      command: "brew",
      args: ["install", "gh"],
      display: "brew install gh",
    };

    const result = await ensureGhAvailable({
      ...io,
      env: {},
      platform: "linux",
      isTTY: true,
      resolveInstall: () => recipe,
      execFile: async (cmd, args) => {
        if (!installed) throw new Error("missing");
        if (cmd === "gh" && args[0] === "--version") {
          return { stdout: "gh version 2.0\n", stderr: "" };
        }
        throw new Error("unexpected");
      },
      confirm: async (msg) => {
        prompts.push(msg);
        // yes to install, yes to auth
        return true;
      },
      runInstall: async (cmd) => {
        expect(cmd.display).toBe("brew install gh");
        installed = true;
        return { ok: true, code: 0 };
      },
      runAuthLogin: async () => ({ ok: true }),
    });

    expect(result).toEqual({ status: "installed", authed: true });
    expect(prompts.some((p) => p.includes("Install GitHub CLI"))).toBe(true);
    expect(prompts.some((p) => p.includes("gh auth login"))).toBe(true);
    expect(io.errors.join("\n")).toContain("gh installed successfully");
    expect(io.errors.join("\n")).toContain("authenticated");
  });

  test("install failure returns install-failed", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable({
      ...io,
      env: {},
      platform: "linux",
      isTTY: true,
      execFile: async () => {
        throw new Error("no gh");
      },
      resolveInstall: () => ({
        label: "dnf",
        command: "sudo",
        args: ["dnf", "install", "-y", "gh"],
        display: "sudo dnf install -y gh",
      }),
      confirm: async () => true,
      runInstall: async () => ({ ok: false, code: 1, error: "exit code 1" }),
    });
    expect(result.status).toBe("install-failed");
    expect(io.errors.join("\n")).toContain("Failed to install gh");
  });

  test("install ok but gh still missing from PATH", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable({
      ...io,
      env: {},
      platform: "linux",
      isTTY: true,
      execFile: async () => {
        throw new Error("still missing");
      },
      resolveInstall: () => ({
        label: "Homebrew",
        command: "brew",
        args: ["install", "gh"],
        display: "brew install gh",
      }),
      confirm: async () => true,
      runInstall: async () => ({ ok: true, code: 0 }),
    });
    expect(result).toEqual({
      status: "install-failed",
      detail: "gh not on PATH after install",
    });
    expect(io.errors.join("\n")).toContain("not on PATH");
  });
});
