import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  anyProbeSucceeds,
  buildWindowsIrmInstallScript,
  defaultRunAuthLogin,
  ensureGhAvailable,
  ensureGitAvailable,
  GH_CLI_LATEST_RELEASE_API,
  GH_INSTALL_DOCS,
  GIT_INSTALL_DOCS,
  ghCandidatePaths,
  gitCandidatePaths,
  hasGithubToken,
  isGhInstalled,
  isGitInstalled,
  isWindowsBatchShim,
  refreshWindowsPath,
  resolveGhInstallCommand,
  resolveGitInstallCommand,
  spawnOptionsForCommand,
  windowsGhAssetArch,
  windowsIrmRecipe,
  wingetCandidatePaths,
  type GhInstallCommand,
} from "../src/gh-install.ts";
import { captureIo } from "./helpers.ts";

/** Default deps for ensureGh tests — skip git bootstrap unless the test covers it. */
function ghOnly(deps: Parameters<typeof ensureGhAvailable>[0] = {}) {
  return { skipGitOffer: true, ...deps };
}

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

  test("windows prefers gh.exe (avoids bare gh.cmd spawn EINVAL)", async () => {
    const tried: string[] = [];
    const ok = await isGhInstalled({
      platform: "win32",
      env: {
        // Avoid accidental hits on the real machine's known paths during unit tests
        ProgramFiles: "C:\\__no_program_files__",
        "ProgramFiles(x86)": "C:\\__no_program_files_x86__",
        LOCALAPPDATA: "C:\\__no_local__",
        USERPROFILE: "C:\\__no_user__",
        ChocolateyInstall: "C:\\__no_choco__",
      },
      execFile: async (cmd) => {
        tried.push(cmd);
        if (cmd !== "gh.exe") throw new Error("nope");
        return { stdout: "gh version 2.0.0\n", stderr: "" };
      },
    });
    expect(ok).toBe(true);
    expect(tried[0]).toBe("gh.exe");
    expect(tried).toEqual(["gh.exe"]);
  });

  test("detects gh at a known absolute install path when not on PATH", async () => {
    const root = mkdtempSync(join(tmpdir(), "gdf-gh-"));
    const ghPath = join(root, "gh.exe");
    writeFileSync(ghPath, ""); // existence only; exec is mocked

    const tried: string[] = [];
    const ok = await isGhInstalled({
      platform: "win32",
      env: {
        ProgramFiles: root,
        "ProgramFiles(x86)": join(root, "x86"),
        LOCALAPPDATA: join(root, "local"),
        USERPROFILE: join(root, "user"),
        ChocolateyInstall: join(root, "choco"),
      },
      execFile: async (cmd) => {
        tried.push(cmd);
        // PATH names fail; absolute MSI path succeeds
        if (cmd === join(root, "GitHub CLI", "gh.exe") || cmd === ghPath) {
          // candidate is ProgramFiles/GitHub CLI/gh.exe — create that layout
          return { stdout: "gh version 2.55.0 (2024-01-01)\n", stderr: "" };
        }
        throw new Error(`not on path: ${cmd}`);
      },
    });

    // Layout for official MSI: %ProgramFiles%\GitHub CLI\gh.exe
    // Recreate expected path used by ghCandidatePaths
    const msiLayout = join(root, "GitHub CLI");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(msiLayout, { recursive: true });
    writeFileSync(join(msiLayout, "gh.exe"), "");

    const ok2 = await isGhInstalled({
      platform: "win32",
      env: {
        ProgramFiles: root,
        "ProgramFiles(x86)": join(root, "x86"),
        LOCALAPPDATA: join(root, "local"),
        USERPROFILE: join(root, "user"),
        ChocolateyInstall: join(root, "choco"),
      },
      execFile: async (cmd) => {
        if (String(cmd).endsWith(join("GitHub CLI", "gh.exe")) || String(cmd).includes("GitHub CLI")) {
          return { stdout: "gh version 2.55.0\n", stderr: "" };
        }
        throw new Error(`not on path: ${cmd}`);
      },
    });
    expect(ok2).toBe(true);
    expect(ok).toBe(false); // first attempt had no GitHub CLI dir yet
    expect(tried.length).toBeGreaterThan(0);
  });

  test("ghCandidatePaths includes MSI default on Windows", () => {
    const paths = ghCandidatePaths(
      {
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        USERPROFILE: "C:\\Users\\me",
      },
      "win32",
    );
    expect(paths.some((p) => p.replace(/\\/g, "/").endsWith("GitHub CLI/gh.exe"))).toBe(true);
  });
});

describe("spawnOptionsForCommand / batch shims", () => {
  test("detects .cmd and .bat", () => {
    expect(isWindowsBatchShim("gh.cmd")).toBe(true);
    expect(isWindowsBatchShim("C:\\\\Tools\\\\gh.CMD")).toBe(true);
    expect(isWindowsBatchShim("setup.bat")).toBe(true);
    expect(isWindowsBatchShim("gh.exe")).toBe(false);
    expect(isWindowsBatchShim("gh")).toBe(false);
  });

  test("forces shell:true for batch shims (Node spawn EINVAL fix)", () => {
    expect(spawnOptionsForCommand("gh.cmd", { shell: false }).shell).toBe(true);
    expect(spawnOptionsForCommand("gh.exe", { shell: false }).shell).toBe(false);
    expect(spawnOptionsForCommand("gh", { shell: true }).shell).toBe(true);
  });
});

describe("anyProbeSucceeds / winget paths", () => {
  test("anyProbeSucceeds tries until one works", async () => {
    const tried: string[] = [];
    const ok = await anyProbeSucceeds(
      async (cmd) => {
        tried.push(cmd);
        if (cmd !== "winget") throw new Error("no");
        return { stdout: "v1.7\n", stderr: "" };
      },
      [
        { command: "where.exe", args: ["winget"] },
        { command: "winget", args: ["--version"] },
      ],
    );
    expect(ok).toBe(true);
    expect(tried).toEqual(["where.exe", "winget"]);
  });

  test("wingetCandidatePaths includes WindowsApps", () => {
    const paths = wingetCandidatePaths({
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
      WINDIR: "C:\\Windows",
    });
    expect(paths.some((p) => p.includes("WindowsApps") && p.endsWith("winget.exe"))).toBe(true);
  });
});

describe("windowsGhAssetArch / irm script (dynamic version)", () => {
  test("maps PROCESSOR_ARCHITECTURE to arch tokens", () => {
    expect(windowsGhAssetArch("AMD64")[0]).toBe("windows_amd64");
    expect(windowsGhAssetArch("ARM64")[0]).toBe("windows_arm64");
    expect(windowsGhAssetArch("x86")[0]).toBe("windows_386");
  });

  test("script uses /releases/latest and never pins a gh version number", () => {
    const script = buildWindowsIrmInstallScript("AMD64");
    expect(script).toContain(GH_CLI_LATEST_RELEASE_API);
    expect(script).toContain("Invoke-RestMethod");
    expect(script).toContain("Invoke-WebRequest");
    expect(script).toContain("msiexec.exe");
    expect(script).toContain("windows_amd64");
    // Dynamic match — version segment is .+ not a literal
    expect(script).toContain("^gh_.+_");
    expect(script).toContain("$rel.tag_name");
    // Must not embed a concrete release version
    expect(script).not.toMatch(/gh_\d+\.\d+\.\d+/);
    expect(script).not.toMatch(/v\d+\.\d+\.\d+/);
    expect(script).not.toContain("2.97");
  });

  test("script installs MSI via separate UAC elevation (no per-user zip)", () => {
    const script = buildWindowsIrmInstallScript("AMD64");
    // MSI only — no per-user zip path
    expect(script).not.toContain("Install-FromZip");
    expect(script).not.toContain("Expand-Archive");
    expect(script).not.toContain("per-user");
    expect(script).toContain("msiexec.exe");
    expect(script).toContain(".msi");
    // Separate elevated process for install step
    expect(script).toContain("RunAs");
    expect(script).toContain("Test-IsAdmin");
    expect(script).toContain("UAC");
    expect(script).toContain("/qb");
    expect(script).toContain("1603");
    expect(script).toContain("/L*v");
  });

  test("windowsIrmRecipe is powershell-irm with dynamic display", () => {
    const r = windowsIrmRecipe({ PROCESSOR_ARCHITECTURE: "AMD64" });
    expect(r.kind).toBe("powershell-irm");
    expect(r.command).toBe("powershell.exe");
    expect(r.display).toContain("releases/latest");
    expect(r.display.toLowerCase()).toContain("msi");
    expect(r.display.toLowerCase()).toContain("uac");
    expect(r.display.toLowerCase()).not.toContain("zip");
    expect(r.args.join(" ")).toContain(GH_CLI_LATEST_RELEASE_API);
  });
});

describe("resolveGhInstallCommand", () => {
  test("prefers brew on darwin when present", async () => {
    const recipe = await resolveGhInstallCommand("darwin", {}, {
      execFile: async (cmd, args) => {
        if (cmd === "which" && args[0] === "brew") {
          return { stdout: "/opt/homebrew/bin/brew\n", stderr: "" };
        }
        throw new Error("missing");
      },
    });
    expect(recipe?.display).toBe("brew install gh");
    expect(recipe?.command).toBe("brew");
  });

  test("uses winget on windows when version probe works", async () => {
    const recipe = await resolveGhInstallCommand("win32", { LOCALAPPDATA: "C:\\none" }, {
      execFile: async (cmd, args) => {
        if (cmd === "winget" && args[0] === "--version") {
          return { stdout: "v1.6.0\n", stderr: "" };
        }
        throw new Error("missing");
      },
    });
    expect(recipe?.label).toContain("winget");
    expect(recipe?.args).toContain("GitHub.cli");
    expect(recipe?.args).toContain("--source");
    expect(recipe?.optimistic).toBeFalsy();
  });

  test("windows falls back to PowerShell irm (dynamic MSI) when nothing detected", async () => {
    const recipe = await resolveGhInstallCommand("win32", {
      LOCALAPPDATA: "C:\\none",
      PROCESSOR_ARCHITECTURE: "AMD64",
    }, {
      execFile: async () => {
        throw new Error("missing");
      },
    });
    expect(recipe).not.toBeNull();
    expect(recipe?.kind).toBe("powershell-irm");
    expect(recipe?.optimistic).toBe(true);
    expect(recipe?.display).toContain("releases/latest");
    expect(recipe?.args.some((a) => a.includes(GH_CLI_LATEST_RELEASE_API))).toBe(true);
  });

  test("uses apt recipe on linux when apt-get exists", async () => {
    const recipe = await resolveGhInstallCommand("linux", {}, {
      execFile: async (cmd, args) => {
        if (cmd === "which" && args[0] === "apt-get") {
          return { stdout: "/usr/bin/apt-get\n", stderr: "" };
        }
        throw new Error("missing");
      },
    });
    expect(recipe?.label).toContain("apt");
    expect(recipe?.command).toBe("bash");
  });

  test("returns null on linux when no package manager found", async () => {
    const recipe = await resolveGhInstallCommand("linux", {}, {
      execFile: async () => {
        throw new Error("missing");
      },
    });
    expect(recipe).toBeNull();
  });
});

describe("refreshWindowsPath", () => {
  test("applies PowerShell registry PATH and extras", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "C:\\Old",
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    };
    await refreshWindowsPath(env, async (cmd) => {
      expect(cmd).toBe("powershell.exe");
      return {
        stdout: "C:\\Windows\\System32;C:\\Program Files\\GitHub CLI\n",
        stderr: "",
      };
    });
    const path = env.PATH ?? "";
    expect(path).toContain("C:\\Windows\\System32");
    expect(path).toContain("GitHub CLI");
    expect(path).toContain("WindowsApps");
    // Git for Windows cmd dir is added for PATH refresh
    expect(path.replace(/\\/g, "/")).toMatch(/Git\/cmd/);
    // MSI system install dir only (no per-user zip path)
    expect(path.replace(/\\/g, "/")).not.toContain("Programs/GitHub CLI/bin");
    expect(env.Path).toBe(env.PATH);
  });
});

describe("ensureGhAvailable", () => {
  test("short-circuits when GITHUB_TOKEN is set", async () => {
    const io = captureIo();
    let probed = false;
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: { GITHUB_TOKEN: "ghp_x" },
      execFile: async () => {
        probed = true;
        throw new Error("should not probe gh");
      },
    }));
    expect(result).toEqual({ status: "token-present" });
    expect(probed).toBe(false);
  });

  test("returns already-installed when gh works", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: {},
      platform: "linux",
      execFile: async () => ({ stdout: "gh version 2.0\n", stderr: "" }),
    }));
    expect(result).toEqual({ status: "already-installed" });
  });

  test("Windows refreshes PATH then detects existing gh without offering install", async () => {
    const io = captureIo();
    let refreshed = false;
    let sawVersion = false;
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: {
        PATH: "C:\\Old",
        ProgramFiles: "C:\\__none__",
        "ProgramFiles(x86)": "C:\\__none86__",
        LOCALAPPDATA: "C:\\__local__",
        USERPROFILE: "C:\\__user__",
      },
      platform: "win32",
      isTTY: true,
      refreshPath: async (env) => {
        refreshed = true;
        env.PATH = "C:\\Program Files\\GitHub CLI";
      },
      execFile: async (cmd, args) => {
        if (args[0] === "--version") {
          sawVersion = true;
          // Return gh version only for gh candidates; git probes should fail
          if (String(cmd).toLowerCase().includes("git")) throw new Error("no git in this test");
          return { stdout: "gh version 2.60.0\n", stderr: "" };
        }
        throw new Error(`unexpected ${cmd}`);
      },
      resolveInstall: () => {
        throw new Error("should not resolve install when gh already present");
      },
      confirm: async () => {
        throw new Error("should not prompt when gh already present");
      },
    }));
    expect(refreshed).toBe(true);
    expect(sawVersion).toBe(true);
    expect(result).toEqual({ status: "already-installed" });
    expect(io.errors.join("\n")).not.toContain("was not found");
  });

  test("non-interactive skips install offer", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: {},
      platform: "linux",
      isTTY: false,
      execFile: async () => {
        throw new Error("no gh");
      },
    }));
    expect(result).toEqual({ status: "skipped-non-interactive" });
    expect(io.errors.join("\n")).toContain("GitHub CLI (gh) was not found");
    expect(io.errors.join("\n")).toContain(GH_INSTALL_DOCS);
    expect(io.errors.join("\n")).toContain("Non-interactive");
  });

  test("TTY user declines install", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable(ghOnly({
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
    }));
    expect(result).toEqual({ status: "skipped-by-user" });
    expect(io.errors.join("\n")).toContain("Skipping gh install");
  });

  test("Windows TTY offers PowerShell irm when no package manager found", async () => {
    const io = captureIo();
    const prompts: string[] = [];
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: { LOCALAPPDATA: "C:\\none", PROCESSOR_ARCHITECTURE: "AMD64" },
      platform: "win32",
      isTTY: true,
      execFile: async () => {
        throw new Error("no tools");
      },
      confirm: async (msg) => {
        prompts.push(msg);
        return false;
      },
    }));
    expect(result).toEqual({ status: "skipped-by-user" });
    expect(prompts.some((p) => p.toLowerCase().includes("powershell") || p.toLowerCase().includes("install github cli"))).toBe(true);
    expect(io.errors.join("\n")).toMatch(/irm|PowerShell|releases\/latest/i);
    expect(io.errors.join("\n")).not.toContain("No supported package manager detected");
  });

  test("Windows declines winget then can accept irm fallback", async () => {
    const io = captureIo();
    const prompts: string[] = [];
    let installed = false;
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: { PROCESSOR_ARCHITECTURE: "AMD64" },
      platform: "win32",
      isTTY: true,
      resolveInstall: () => ({
        label: "winget",
        command: "winget",
        args: ["install", "--id", "GitHub.cli"],
        display: "winget install --id GitHub.cli",
        kind: "winget",
      }),
      confirm: async (msg) => {
        prompts.push(msg);
        // decline winget, accept irm fallback
        if (msg.toLowerCase().includes("powershell") || msg.toLowerCase().includes("irm")) {
          return true;
        }
        if (msg.includes("winget")) return false;
        if (msg.includes("auth login")) return false;
        return false;
      },
      runInstall: async (cmd) => {
        expect(cmd.kind).toBe("powershell-irm");
        installed = true;
        return { ok: true, code: 0 };
      },
      refreshPath: async () => {},
      execFile: async (cmd, args) => {
        if (!installed) throw new Error("no gh");
        if (args[0] === "--version") return { stdout: "gh version 9.9.9\n", stderr: "" };
        throw new Error(`unexpected ${cmd}`);
      },
    }));
    expect(result).toEqual({ status: "installed", authed: false });
    expect(installed).toBe(true);
  });

  test("Windows winget failure auto-offers irm fallback", async () => {
    const io = captureIo();
    const prompts: string[] = [];
    let step = 0;
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: { PROCESSOR_ARCHITECTURE: "AMD64" },
      platform: "win32",
      isTTY: true,
      resolveInstall: () => ({
        label: "winget",
        command: "winget",
        args: ["install", "--id", "GitHub.cli"],
        display: "winget install --id GitHub.cli",
        kind: "winget",
      }),
      confirm: async (msg) => {
        prompts.push(msg);
        if (msg.includes("auth login")) return false;
        return true; // accept winget and then irm fallback
      },
      runInstall: async (cmd) => {
        step++;
        if (cmd.kind === "winget") return { ok: false, code: 1, error: "exit code 1" };
        expect(cmd.kind).toBe("powershell-irm");
        return { ok: true, code: 0 };
      },
      refreshPath: async () => {},
      execFile: async (_cmd, args) => {
        if (step < 2) throw new Error("no gh");
        if (args[0] === "--version") return { stdout: "gh version 1.2.3\n", stderr: "" };
        throw new Error("unexpected");
      },
    }));
    expect(result).toEqual({ status: "installed", authed: false });
    expect(io.errors.join("\n")).toMatch(/fallback|PowerShell/i);
  });

  test("TTY no recipe prints manual guidance on linux", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: {},
      platform: "linux",
      isTTY: true,
      execFile: async () => {
        throw new Error("no gh");
      },
      resolveInstall: () => null,
    }));
    expect(result).toEqual({ status: "no-recipe" });
    expect(io.errors.join("\n")).toContain("No supported install method");
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

    const result = await ensureGhAvailable(ghOnly({
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
        return true;
      },
      runInstall: async (cmd) => {
        expect(cmd.display).toBe("brew install gh");
        installed = true;
        return { ok: true, code: 0 };
      },
      runAuthLogin: async () => ({ ok: true }),
    }));

    expect(result).toEqual({ status: "installed", authed: true });
    expect(prompts.some((p) => p.includes("Install GitHub CLI"))).toBe(true);
    expect(prompts.some((p) => p.includes("gh auth login"))).toBe(true);
    expect(io.errors.join("\n")).toContain("gh installed successfully");
    expect(io.errors.join("\n")).toContain("authenticated");
  });

  test("windows install refreshes PATH before re-probing gh", async () => {
    const io = captureIo();
    let refreshed = false;
    let installed = false;
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: { PATH: "C:\\Old" },
      platform: "win32",
      isTTY: true,
      resolveInstall: () => ({
        label: "winget",
        command: "winget",
        args: ["install", "--id", "GitHub.cli", "-e"],
        display: "winget install --id GitHub.cli -e",
        shell: true,
        kind: "winget",
      }),
      confirm: async (msg) => msg.includes("Install GitHub CLI") && msg.includes("winget"),
      runInstall: async () => {
        installed = true;
        return { ok: true, code: 0 };
      },
      refreshPath: async (env) => {
        refreshed = true;
        env.PATH = "C:\\Program Files\\GitHub CLI";
      },
      execFile: async (cmd, args) => {
        if (!installed || !refreshed) throw new Error("gh missing");
        if ((cmd === "gh" || cmd === "gh.exe" || cmd === "gh.cmd") && args[0] === "--version") {
          return { stdout: "gh version 2.0\n", stderr: "" };
        }
        throw new Error(`unexpected ${cmd}`);
      },
    }));
    expect(refreshed).toBe(true);
    expect(result).toEqual({ status: "installed", authed: false });
  });

  test("install failure returns install-failed with windows tips", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: {},
      platform: "win32",
      isTTY: true,
      execFile: async () => {
        throw new Error("no gh");
      },
      // Only irm, and it fails — no further fallback
      resolveInstall: () => ({
        label: "PowerShell (irm latest MSI)",
        command: "powershell.exe",
        args: ["-Command", "throw"],
        display: "irm latest msi",
        kind: "powershell-irm",
      }),
      confirm: async () => true,
      runInstall: async () => ({ ok: false, code: 1, error: "exit code 1" }),
    }));
    expect(result.status).toBe("install-failed");
    expect(io.errors.join("\n")).toContain("Failed to install gh");
    expect(io.errors.join("\n")).toMatch(/winget|releases\/latest|GITHUB_TOKEN/i);
  });

  test("install ok but gh still missing from PATH", async () => {
    const io = captureIo();
    const result = await ensureGhAvailable(ghOnly({
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
    }));
    expect(result).toEqual({
      status: "install-failed",
      detail: "gh not on PATH after install",
    });
    expect(io.errors.join("\n")).toContain("not on PATH");
  });

  test("surfaces auth login spawn EINVAL with guidance", async () => {
    const io = captureIo();
    let installed = false;
    const result = await ensureGhAvailable(ghOnly({
      ...io,
      env: {},
      platform: "win32",
      isTTY: true,
      resolveInstall: () => ({
        label: "winget",
        command: "winget",
        args: ["install", "--id", "GitHub.cli"],
        display: "winget install",
        kind: "winget",
      }),
      confirm: async (msg) =>
        msg.includes("Install GitHub CLI") || msg.includes("auth login"),
      runInstall: async () => {
        installed = true;
        return { ok: true, code: 0 };
      },
      refreshPath: async () => {},
      execFile: async (_cmd, args) => {
        // Missing before install; present after — drives the install+login path
        if (!installed) throw new Error("no gh");
        if (args[0] === "--version") return { stdout: "gh version 2.0\n", stderr: "" };
        throw new Error("unexpected");
      },
      runAuthLogin: async () => ({
        ok: false,
        error: "spawn EINVAL (Windows: use gh.exe or shell for .cmd; or run: gh auth login)",
      }),
    }));
    expect(result).toEqual({ status: "installed", authed: false });
    expect(io.errors.join("\n")).toMatch(/EINVAL|gh auth login/i);
  });

  test("offers git install before gh when both missing", async () => {
    const io = captureIo();
    const prompts: string[] = [];
    const installs: string[] = [];
    let gitOk = false;
    let ghOk = false;

    const result = await ensureGhAvailable({
      ...io,
      env: {},
      platform: "linux",
      isTTY: true,
      skipGitOffer: false,
      resolveGitInstall: () => ({
        label: "apt · Git",
        command: "bash",
        args: ["-lc", "sudo apt-get install -y git"],
        display: "sudo apt-get install -y git",
        kind: "apt",
      }),
      resolveInstall: () => ({
        label: "Homebrew",
        command: "brew",
        args: ["install", "gh"],
        display: "brew install gh",
        kind: "brew",
      }),
      confirm: async (msg) => {
        prompts.push(msg);
        if (msg.includes("auth login")) return false;
        return true;
      },
      runInstall: async (cmd) => {
        installs.push(cmd.display);
        if (cmd.display.includes("git")) gitOk = true;
        if (cmd.display.includes("gh")) ghOk = true;
        return { ok: true, code: 0 };
      },
      execFile: async (cmd, args) => {
        if (args[0] !== "--version") throw new Error(`unexpected ${cmd}`);
        if (String(cmd).includes("git") || cmd === "git") {
          if (!gitOk) throw new Error("no git");
          return { stdout: "git version 2.40.0\n", stderr: "" };
        }
        if (!ghOk) throw new Error("no gh");
        return { stdout: "gh version 2.0\n", stderr: "" };
      },
    });

    expect(installs[0]).toContain("git");
    expect(installs.some((d) => d.includes("gh"))).toBe(true);
    expect(prompts.some((p) => p.includes("Install Git"))).toBe(true);
    expect(prompts.some((p) => p.includes("Install GitHub CLI"))).toBe(true);
    expect(result).toEqual({ status: "installed", authed: false });
    expect(io.errors.join("\n")).toContain("git installed successfully");
  });
});

describe("isGitInstalled / resolveGitInstallCommand", () => {
  test("true when git --version succeeds", async () => {
    const ok = await isGitInstalled({
      platform: "linux",
      execFile: async (cmd, args) => {
        expect(cmd).toBe("git");
        expect(args).toEqual(["--version"]);
        return { stdout: "git version 2.43.0\n", stderr: "" };
      },
    });
    expect(ok).toBe(true);
  });

  test("gitCandidatePaths includes Git for Windows defaults", () => {
    const paths = gitCandidatePaths(
      {
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        USERPROFILE: "C:\\Users\\me",
      },
      "win32",
    );
    expect(paths.some((p) => p.replace(/\\/g, "/").endsWith("Git/cmd/git.exe"))).toBe(true);
  });

  test("resolveGitInstallCommand prefers brew on darwin", async () => {
    const recipe = await resolveGitInstallCommand("darwin", {}, {
      execFile: async (cmd, args) => {
        if (cmd === "which" && args[0] === "brew") {
          return { stdout: "/opt/homebrew/bin/brew\n", stderr: "" };
        }
        throw new Error("missing");
      },
    });
    expect(recipe?.display).toBe("brew install git");
  });

  test("resolveGitInstallCommand uses winget Git.Git on windows", async () => {
    const recipe = await resolveGitInstallCommand("win32", { LOCALAPPDATA: "C:\\none" }, {
      execFile: async (cmd, args) => {
        if (cmd === "winget" && args[0] === "--version") {
          return { stdout: "v1.6.0\n", stderr: "" };
        }
        throw new Error("missing");
      },
    });
    expect(recipe?.args).toContain("Git.Git");
    expect(recipe?.display).toContain("Git.Git");
  });
});

describe("ensureGitAvailable", () => {
  test("already-installed when git works", async () => {
    const io = captureIo();
    const result = await ensureGitAvailable({
      ...io,
      env: {},
      platform: "linux",
      execFile: async () => ({ stdout: "git version 2.40.0\n", stderr: "" }),
    });
    expect(result).toEqual({ status: "already-installed" });
  });

  test("TTY installs git via recipe", async () => {
    const io = captureIo();
    let installed = false;
    const result = await ensureGitAvailable({
      ...io,
      env: {},
      platform: "linux",
      isTTY: true,
      resolveGitInstall: () => ({
        label: "apt · Git",
        command: "bash",
        args: ["-lc", "sudo apt-get install -y git"],
        display: "sudo apt-get install -y git",
        kind: "apt",
      }),
      confirm: async (msg) => msg.includes("Install Git"),
      runInstall: async (cmd) => {
        expect(cmd.display).toContain("git");
        installed = true;
        return { ok: true, code: 0 };
      },
      execFile: async (cmd, args) => {
        if (args[0] === "--version") {
          if (!installed) throw new Error("no git");
          return { stdout: "git version 2.40.0\n", stderr: "" };
        }
        throw new Error(`unexpected ${cmd}`);
      },
    });
    expect(result).toEqual({ status: "installed" });
    expect(io.errors.join("\n")).toContain(GIT_INSTALL_DOCS);
    expect(io.errors.join("\n")).toContain("git installed successfully");
  });
});

describe("defaultRunAuthLogin", () => {
  test("is exported for interactive Windows login", () => {
    expect(typeof defaultRunAuthLogin).toBe("function");
  });
});
