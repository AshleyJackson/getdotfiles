import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { confirm, type ConfirmFn } from "./cli.ts";
import {
  ghTokenInvocations,
  type ExecFileFn,
  type GithubDeps,
} from "./github.ts";
import type { Platform } from "./schemas.ts";

const execFileAsync = promisify(execFile);

export type GhInstallCommand = {
  /** Short human label, e.g. "Homebrew" */
  label: string;
  /** Executable to run */
  command: string;
  /** Args for the executable */
  args: string[];
  /** Use a shell (needed for some one-liners / PATH shims) */
  shell?: boolean;
  /** Full display string shown to the user */
  display: string;
};

export type GhInstallDeps = GithubDeps & {
  confirm?: typeof confirm;
  isTTY?: boolean;
  /** Override which install recipe to use (tests). */
  resolveInstall?: (platform: Platform, env: NodeJS.ProcessEnv) => GhInstallCommand | null;
  /** Run an install command; default inherits stdio. */
  runInstall?: (
    cmd: GhInstallCommand,
  ) => Promise<{ ok: boolean; code: number | null; error?: string }>;
  /** After install, optionally run `gh auth login`. */
  runAuthLogin?: () => Promise<{ ok: boolean; error?: string }>;
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  /** Skip the offer entirely (tests / CI). */
  skipOffer?: boolean;
};

async function defaultExecFile(
  file: string,
  args: readonly string[],
  options?: { shell?: boolean | string; windowsHide?: boolean },
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, [...args], options);
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

/**
 * Probe whether any gh binary responds to --version.
 */
export async function isGhInstalled(deps: GithubDeps = {}): Promise<boolean> {
  const run = deps.execFile ?? defaultExecFile;
  const platform = deps.platform ?? process.platform;

  // Reuse the same candidate list as token resolution (cmd/exe/shell on Windows)
  for (const { command, options } of ghTokenInvocations(platform)) {
    try {
      const { stdout } = await run(command, ["--version"], options);
      if (stdout.toLowerCase().includes("gh version") || stdout.trim().length > 0) {
        return true;
      }
    } catch {
      // try next
    }
  }
  return false;
}

/**
 * True when GITHUB_TOKEN is already set (non-empty).
 */
export function hasGithubToken(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim());
}

async function commandExists(
  run: ExecFileFn,
  command: string,
  platform: Platform,
): Promise<boolean> {
  try {
    if (platform === "win32") {
      await run("where.exe", [command], { windowsHide: true });
      return true;
    }
    await run("which", [command], {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick a reasonable install recipe for this machine.
 * Returns null when we cannot safely auto-install (still print docs URL).
 */
export async function resolveGhInstallCommand(
  platform: Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  deps: { execFile?: ExecFileFn } = {},
): Promise<GhInstallCommand | null> {
  const run = deps.execFile ?? defaultExecFile;

  if (platform === "darwin") {
    if (await commandExists(run, "brew", platform)) {
      return {
        label: "Homebrew",
        command: "brew",
        args: ["install", "gh"],
        display: "brew install gh",
      };
    }
    return null;
  }

  if (platform === "win32") {
    if (await commandExists(run, "winget", platform)) {
      return {
        label: "winget",
        command: "winget",
        args: ["install", "--id", "GitHub.cli", "-e", "--accept-package-agreements", "--accept-source-agreements"],
        display: "winget install --id GitHub.cli -e",
        shell: true,
      };
    }
    if (await commandExists(run, "scoop", platform)) {
      return {
        label: "Scoop",
        command: "scoop",
        args: ["install", "gh"],
        display: "scoop install gh",
        shell: true,
      };
    }
    if (await commandExists(run, "choco", platform)) {
      return {
        label: "Chocolatey",
        command: "choco",
        args: ["install", "gh", "-y"],
        display: "choco install gh -y",
        shell: true,
      };
    }
    return null;
  }

  // Linux / other Unix
  if (await commandExists(run, "brew", platform)) {
    return {
      label: "Homebrew",
      command: "brew",
      args: ["install", "gh"],
      display: "brew install gh",
    };
  }
  if (await commandExists(run, "apt-get", platform)) {
    // Official GitHub CLI apt repository bootstrap (requires sudo / network)
    const script =
      "set -e; " +
      "(command -v wget >/dev/null || (sudo apt-get update && sudo apt-get install -y wget)); " +
      "sudo mkdir -p -m 755 /etc/apt/keyrings; " +
      "out=$(mktemp); " +
      "wget -qO\"$out\" https://cli.github.com/packages/githubcli-archive-keyring.gpg; " +
      "cat \"$out\" | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null; " +
      "sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; " +
      "echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null; " +
      "sudo apt-get update; " +
      "sudo apt-get install -y gh";
    return {
      label: "apt (GitHub CLI repo)",
      command: "bash",
      args: ["-lc", script],
      display: "sudo apt install gh  (via official GitHub CLI apt repository)",
    };
  }
  if (await commandExists(run, "dnf", platform)) {
    return {
      label: "dnf",
      command: "sudo",
      args: ["dnf", "install", "-y", "gh"],
      display: "sudo dnf install -y gh",
    };
  }
  if (await commandExists(run, "pacman", platform)) {
    return {
      label: "pacman",
      command: "sudo",
      args: ["pacman", "-S", "--noconfirm", "github-cli"],
      display: "sudo pacman -S github-cli",
    };
  }
  if (await commandExists(run, "zypper", platform)) {
    return {
      label: "zypper",
      command: "sudo",
      args: ["zypper", "--non-interactive", "install", "gh"],
      display: "sudo zypper install gh",
    };
  }

  void env;
  return null;
}

async function defaultRunInstall(
  cmd: GhInstallCommand,
): Promise<{ ok: boolean; code: number | null; error?: string }> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(cmd.command, cmd.args, {
      stdio: "inherit",
      shell: cmd.shell ?? false,
      windowsHide: true,
      env: process.env,
    });
    child.on("error", (err) => {
      resolve({ ok: false, code: null, error: err.message });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code });
    });
  });
}

async function defaultRunAuthLogin(
  deps: GithubDeps,
): Promise<{ ok: boolean; error?: string }> {
  const { spawn } = await import("node:child_process");
  const platform = deps.platform ?? process.platform;
  const candidates = ghTokenInvocations(platform);

  for (const inv of candidates) {
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const child = spawn(inv.command, ["auth", "login"], {
        stdio: "inherit",
        shell: inv.options.shell ?? false,
        windowsHide: inv.options.windowsHide ?? true,
        env: process.env,
      });
      child.on("error", (err) => resolve({ ok: false, error: err.message }));
      child.on("close", (code) => resolve({ ok: code === 0 }));
    });
    if (result.ok) return result;
    // try next candidate only on spawn failure-ish; if gh ran and user cancelled, stop
    if (!result.error) return result;
  }
  return { ok: false, error: "could not start gh auth login" };
}

export const GH_INSTALL_DOCS = "https://github.com/cli/cli#installation";

export type EnsureGhResult =
  | { status: "token-present" }
  | { status: "already-installed" }
  | { status: "skipped-non-interactive" }
  | { status: "skipped-by-user" }
  | { status: "no-recipe" }
  | { status: "install-failed"; detail?: string }
  | { status: "installed"; authed: boolean };

/**
 * If GITHUB_TOKEN is unset and `gh` is missing, explain why it helps and
 * offer to run a platform-appropriate install (TTY only).
 */
export async function ensureGhAvailable(deps: GhInstallDeps = {}): Promise<EnsureGhResult> {
  const env = deps.env ?? process.env;
  const error = deps.error ?? console.error;
  const ask = deps.confirm ?? confirm;
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY);
  const platform = (deps.platform ?? process.platform) as Platform;

  if (deps.skipOffer) return { status: "skipped-non-interactive" };
  if (hasGithubToken(env)) return { status: "token-present" };

  const installed = await isGhInstalled(deps);
  if (installed) return { status: "already-installed" };

  error("\nGitHub CLI (gh) was not found on PATH.");
  error("Without gh or GITHUB_TOKEN, API access is limited to 60 requests/hour.");
  error(`Install docs: ${GH_INSTALL_DOCS}`);
  error("Or set GITHUB_TOKEN to a personal access token.\n");

  if (!isTTY) {
    error("Non-interactive session: continuing without gh.\n");
    return { status: "skipped-non-interactive" };
  }

  const recipe =
    deps.resolveInstall?.(platform, env) ??
    (await resolveGhInstallCommand(platform, env, deps));

  if (!recipe) {
    error("No supported package manager detected for automatic install.");
    error("Install gh manually, run `gh auth login`, then retry — or set GITHUB_TOKEN.\n");
    return { status: "no-recipe" };
  }

  error(`Detected install method: ${recipe.label}`);
  error(`  ${recipe.display}\n`);

  const wantsInstall = await ask(`Install GitHub CLI (gh) now via ${recipe.label}? [y/N] `, {
    isTTY: true,
  });
  if (!wantsInstall) {
    error("Skipping gh install. Continuing unauthenticated (or use GITHUB_TOKEN).\n");
    return { status: "skipped-by-user" };
  }

  error(`\nRunning: ${recipe.display}\n`);
  const runInstall = deps.runInstall ?? defaultRunInstall;
  const installResult = await runInstall(recipe);
  if (!installResult.ok) {
    const detail =
      installResult.error ??
      (installResult.code != null ? `exit code ${installResult.code}` : "unknown error");
    error(`\nFailed to install gh (${detail}).`);
    error(`See ${GH_INSTALL_DOCS} or set GITHUB_TOKEN.\n`);
    return { status: "install-failed", detail };
  }

  // Re-check PATH; some installs need a new shell
  const nowInstalled = await isGhInstalled(deps);
  if (!nowInstalled) {
    error("\ngh install finished, but `gh` is not on PATH in this session.");
    error("Open a new terminal (or re-auth your shell), then re-run getdotfiles.");
    error("You can also set GITHUB_TOKEN instead.\n");
    return { status: "install-failed", detail: "gh not on PATH after install" };
  }

  error("\ngh installed successfully.");

  let authed = false;
  const wantsLogin = await ask("Run `gh auth login` now? [y/N] ", { isTTY: true });
  if (wantsLogin) {
    const runAuth = deps.runAuthLogin ?? (() => defaultRunAuthLogin(deps));
    const authResult = await runAuth();
    authed = authResult.ok;
    if (!authResult.ok) {
      error(
        `\ngh auth login did not complete${authResult.error ? ` (${authResult.error})` : ""}.`,
      );
      error("You can run it later, or set GITHUB_TOKEN.\n");
    } else {
      error("\nGitHub CLI authenticated.\n");
    }
  } else {
    error("Skipped auth login. Run `gh auth login` later or set GITHUB_TOKEN.\n");
  }

  return { status: "installed", authed };
}

/** Test helper: confirm wrapper type re-export */
export type { ConfirmFn };
