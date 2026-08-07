import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { confirm, type ConfirmFn } from "./cli.ts";
import {
  ghInteractiveInvocations,
  ghTokenInvocations,
  type ExecFileFn,
  type GithubDeps,
} from "./github.ts";
import type { Platform } from "./schemas.ts";

const execFileAsync = promisify(execFile);

/**
 * True when `command` looks like a Windows batch shim (.cmd / .bat).
 * Node refuses to spawn these without `shell: true` (spawn EINVAL).
 */
export function isWindowsBatchShim(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command);
}

/**
 * Normalize spawn options so Windows .cmd/.bat never runs without a shell.
 */
export function spawnOptionsForCommand(
  command: string,
  options: { shell?: boolean | string; windowsHide?: boolean } = {},
): { shell: boolean | string; windowsHide?: boolean } {
  const needsShell = isWindowsBatchShim(command);
  return {
    ...options,
    shell: options.shell || needsShell || false,
    windowsHide: options.windowsHide,
  };
}

export type GhInstallCommand = {
  /** Short human label, e.g. "Homebrew" */
  label: string;
  /** Executable to run */
  command: string;
  /** Args for the executable */
  args: string[];
  /** Use a shell (needed for Windows PATH shims / App Execution Aliases) */
  shell?: boolean;
  /** Full display string shown to the user */
  display: string;
  /**
   * When true, this recipe is offered even if the package manager was not
   * positively detected.
   */
  optimistic?: boolean;
  /** Machine-readable kind for fallbacks / tests */
  kind?: "winget" | "scoop" | "choco" | "powershell-irm" | "brew" | "apt" | "dnf" | "pacman" | "zypper";
};

export type GhInstallDeps = GithubDeps & {
  confirm?: typeof confirm;
  isTTY?: boolean;
  /** Override which install recipe to use for gh (tests). */
  resolveInstall?: (
    platform: Platform,
    env: NodeJS.ProcessEnv,
  ) => GhInstallCommand | null | Promise<GhInstallCommand | null>;
  /** Override which install recipe to use for git (tests). */
  resolveGitInstall?: (
    platform: Platform,
    env: NodeJS.ProcessEnv,
  ) => GhInstallCommand | null | Promise<GhInstallCommand | null>;
  /** Run an install command; default inherits stdio. */
  runInstall?: (
    cmd: GhInstallCommand,
  ) => Promise<{ ok: boolean; code: number | null; error?: string }>;
  /** After install, optionally run `gh auth login`. */
  runAuthLogin?: () => Promise<{ ok: boolean; error?: string }>;
  /** Refresh process PATH from the OS (Windows registry / login shell). */
  refreshPath?: (env: NodeJS.ProcessEnv, run?: ExecFileFn) => Promise<void>;
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  /** Skip the offer entirely (tests / CI). */
  skipOffer?: boolean;
  /** Skip git bootstrap (tests). */
  skipGitOffer?: boolean;
};

type Probe = {
  command: string;
  args: string[];
  options?: { shell?: boolean; windowsHide?: boolean };
};

async function defaultExecFile(
  file: string,
  args: readonly string[],
  options?: { shell?: boolean | string; windowsHide?: boolean },
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, [...args], {
    ...options,
    timeout: 15_000,
    windowsHide: options?.windowsHide ?? true,
  });
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

/**
 * Well-known absolute paths where the official GitHub CLI installer places `gh`.
 * Used when PATH is stale (common right after MSI install, or in a shell that
 * never reloaded User/Machine PATH).
 */
export function ghCandidatePaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: Platform = process.platform,
): string[] {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    const pf = env.ProgramFiles || "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const userProfile = env.USERPROFILE || homedir();
    return [
      join(pf, "GitHub CLI", "gh.exe"),
      join(pf86, "GitHub CLI", "gh.exe"),
      // scoop default
      join(userProfile, "scoop", "shims", "gh.exe"),
      join(userProfile, "scoop", "apps", "gh", "current", "bin", "gh.exe"),
      // chocolatey default
      join(env.ChocolateyInstall || "C:\\ProgramData\\chocolatey", "bin", "gh.exe"),
      // occasional per-user / winget portable layouts
      join(local, "Programs", "GitHub CLI", "gh.exe"),
      join(local, "Programs", "GitHub CLI", "bin", "gh.exe"),
      join(local, "Microsoft", "WinGet", "Links", "gh.exe"),
    ];
  }

  if (platform === "darwin") {
    return [
      "/opt/homebrew/bin/gh",
      "/usr/local/bin/gh",
      join(homedir(), ".local", "bin", "gh"),
    ];
  }

  // linux / other unix
  return [
    "/usr/bin/gh",
    "/usr/local/bin/gh",
    "/home/linuxbrew/.linuxbrew/bin/gh",
    join(homedir(), ".local", "bin", "gh"),
    join(homedir(), "bin", "gh"),
  ];
}

/**
 * Well-known absolute paths for Git (Git for Windows / brew / distro packages).
 */
export function gitCandidatePaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: Platform = process.platform,
): string[] {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    const pf = env.ProgramFiles || "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const userProfile = env.USERPROFILE || homedir();
    return [
      join(pf, "Git", "cmd", "git.exe"),
      join(pf, "Git", "bin", "git.exe"),
      join(pf86, "Git", "cmd", "git.exe"),
      join(pf86, "Git", "bin", "git.exe"),
      join(userProfile, "scoop", "shims", "git.exe"),
      join(env.ChocolateyInstall || "C:\\ProgramData\\chocolatey", "bin", "git.exe"),
      join(local, "Programs", "Git", "cmd", "git.exe"),
      join(local, "Microsoft", "WinGet", "Links", "git.exe"),
    ];
  }

  if (platform === "darwin") {
    return [
      "/opt/homebrew/bin/git",
      "/usr/local/bin/git",
      "/usr/bin/git",
      join(homedir(), ".local", "bin", "git"),
    ];
  }

  return [
    "/usr/bin/git",
    "/usr/local/bin/git",
    "/home/linuxbrew/.linuxbrew/bin/git",
    join(homedir(), ".local", "bin", "git"),
    join(homedir(), "bin", "git"),
  ];
}

function looksLikeGhVersion(stdout: string, stderr = ""): boolean {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  return text.includes("gh version") || /gh\s+version\s+\d/i.test(text) || stdout.trim().length > 0;
}

function looksLikeGitVersion(stdout: string, stderr = ""): boolean {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  return text.includes("git version") || /git\s+version\s+\d/i.test(text);
}

type CliTool = "gh" | "git";

/**
 * Shared detector for gh/git: PATH names → absolute known paths → where/which.
 */
export async function isCliToolInstalled(
  tool: CliTool,
  deps: GithubDeps = {},
): Promise<boolean> {
  const run = deps.execFile ?? defaultExecFile;
  const platform = (deps.platform ?? process.platform) as Platform;
  const env = deps.env ?? process.env;
  const absolutePaths =
    tool === "gh" ? ghCandidatePaths(env, platform) : gitCandidatePaths(env, platform);
  const matchVersion = tool === "gh" ? looksLikeGhVersion : looksLikeGitVersion;

  const tryVersion = async (
    command: string,
    options: { shell?: boolean | string; windowsHide?: boolean } = {},
  ): Promise<boolean> => {
    try {
      const opts = spawnOptionsForCommand(command, {
        windowsHide: true,
        ...options,
      });
      const { stdout, stderr } = await run(command, ["--version"], opts);
      return matchVersion(stdout, stderr) || (tool === "gh" && stdout.trim().length > 0);
    } catch {
      return false;
    }
  };

  // 1) PATH / name-based candidates
  if (tool === "gh") {
    for (const { command, options } of ghTokenInvocations(platform)) {
      if (await tryVersion(command, options)) return true;
    }
  } else if (platform === "win32") {
    for (const name of ["git.exe", "git", "git.cmd"] as const) {
      const shell = isWindowsBatchShim(name);
      if (await tryVersion(name, { shell, windowsHide: true })) return true;
      if (!shell && (await tryVersion(name, { shell: true, windowsHide: true }))) return true;
    }
  } else if (await tryVersion("git")) {
    return true;
  }

  // 2) Absolute install locations that exist on disk
  for (const abs of absolutePaths) {
    if (!existsSync(abs)) continue;
    if (await tryVersion(abs, { windowsHide: true })) return true;
  }

  // 3) OS lookup helpers
  if (platform === "win32") {
    const whereProbes: Probe[] = [
      { command: "where.exe", args: [tool], options: { windowsHide: true } },
      { command: "where.exe", args: [`${tool}.exe`], options: { windowsHide: true } },
      {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", `where ${tool}`],
        options: { windowsHide: true },
      },
    ];
    for (const probe of whereProbes) {
      try {
        const { stdout } = await run(probe.command, probe.args, probe.options ?? {});
        const first = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l && !l.toLowerCase().includes("could not") && existsSync(l));
        if (first && (await tryVersion(first, { windowsHide: true }))) return true;
      } catch {
        // try next
      }
    }
  } else {
    for (const finder of ["which", "command"] as const) {
      try {
        const args = finder === "which" ? [tool] : ["-v", tool];
        const { stdout } = await run(finder, args, finder === "command" ? { shell: true } : {});
        const first = stdout.trim().split(/\r?\n/)[0]?.trim();
        if (first && existsSync(first) && (await tryVersion(first))) return true;
      } catch {
        // try next
      }
    }
  }

  return false;
}

/** Probe whether any gh binary responds to --version (PATH + known install dirs). */
export async function isGhInstalled(deps: GithubDeps = {}): Promise<boolean> {
  return isCliToolInstalled("gh", deps);
}

/** Probe whether git is available (PATH + known install dirs). */
export async function isGitInstalled(deps: GithubDeps = {}): Promise<boolean> {
  return isCliToolInstalled("git", deps);
}

export const GIT_INSTALL_DOCS = "https://git-scm.com/downloads";

/**
 * True when GITHUB_TOKEN is already set (non-empty).
 */
export function hasGithubToken(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim());
}

/**
 * Try a list of exec probes; true if any succeeds with non-empty output
 * or exit 0 (some tools print to stderr).
 */
export async function anyProbeSucceeds(
  run: ExecFileFn,
  probes: readonly Probe[],
): Promise<boolean> {
  for (const probe of probes) {
    try {
      const { stdout, stderr } = await run(probe.command, probe.args, probe.options ?? {});
      if (stdout.trim() || stderr.trim()) return true;
      return true;
    } catch {
      // try next probe
    }
  }
  return false;
}

/** Well-known winget locations on consumer Windows installs. */
export function wingetCandidatePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const local = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const winDir = env.WINDIR || env.SystemRoot || "C:\\Windows";
  return [
    join(local, "Microsoft", "WindowsApps", "winget.exe"),
    join(winDir, "System32", "winget.exe"),
  ];
}

function windowsToolProbes(name: string, versionArgs: string[] = ["--version"]): Probe[] {
  return [
    { command: `${name}.exe`, args: versionArgs, options: { windowsHide: true } },
    { command: name, args: versionArgs, options: { windowsHide: true } },
    { command: `${name}.cmd`, args: versionArgs, options: { windowsHide: true } },
    { command: name, args: versionArgs, options: { shell: true, windowsHide: true } },
    { command: "where.exe", args: [name], options: { windowsHide: true } },
    { command: "where.exe", args: [name], options: { shell: true, windowsHide: true } },
    { command: "cmd.exe", args: ["/d", "/s", "/c", `where ${name}`], options: { windowsHide: true } },
  ];
}

async function windowsHasTool(
  run: ExecFileFn,
  name: string,
  env: NodeJS.ProcessEnv,
  versionArgs?: string[],
): Promise<boolean> {
  const probes = windowsToolProbes(name, versionArgs);

  if (name === "winget") {
    for (const p of wingetCandidatePaths(env)) {
      if (existsSync(p)) {
        probes.unshift({
          command: p,
          args: versionArgs ?? ["--version"],
          options: { windowsHide: true },
        });
      }
    }
  }

  return anyProbeSucceeds(run, probes);
}

async function unixHasTool(run: ExecFileFn, name: string): Promise<boolean> {
  return anyProbeSucceeds(run, [
    { command: "which", args: [name] },
    { command: "command", args: ["-v", name], options: { shell: true } },
    { command: name, args: ["--version"] },
  ]);
}

/**
 * Refresh process.env.PATH from the live Windows user+machine PATH so
 * newly installed tools (gh) are visible without opening a new terminal.
 */
export async function refreshWindowsPath(
  env: NodeJS.ProcessEnv = process.env,
  run: ExecFileFn = defaultExecFile,
): Promise<void> {
  try {
    const ps =
      "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + " +
      "[Environment]::GetEnvironmentVariable('Path','User')";
    const { stdout } = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { windowsHide: true },
    );
    const refreshed = stdout.replace(/\r?\n/g, "").trim();
    if (refreshed) {
      env.PATH = refreshed;
      env.Path = refreshed;
    }
  } catch {
    // best-effort
  }

  const localAppData = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const pf = env.ProgramFiles || "C:\\Program Files";
  const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const extras = [
    // MSI default install dir (system-wide, after elevated msiexec)
    join(pf, "GitHub CLI"),
    join(pf86, "GitHub CLI"),
    // Git for Windows (needed by gh auth / git operations)
    join(pf, "Git", "cmd"),
    join(pf, "Git", "bin"),
    join(pf86, "Git", "cmd"),
    join(pf86, "Git", "bin"),
    join(localAppData, "Microsoft", "WindowsApps"),
  ];
  const current = env.PATH || env.Path || "";
  const parts = current.split(";").filter(Boolean);
  for (const extra of extras) {
    if (extra && !parts.some((p) => p.toLowerCase() === extra.toLowerCase())) {
      parts.push(extra);
    }
  }
  env.PATH = parts.join(";");
  env.Path = env.PATH;
}

/**
 * Map Windows PROCESSOR_ARCHITECTURE to gh release asset arch tokens.
 * Asset names are always versioned dynamically, e.g. gh_<version>_windows_amd64.msi
 * — never hardcode a gh version; resolve via /repos/cli/cli/releases/latest.
 * @see https://github.com/cli/cli/blob/trunk/docs/install_windows.md
 */
export function windowsGhAssetArch(
  arch: string = process.env.PROCESSOR_ARCHITECTURE || "AMD64",
): string[] {
  const a = arch.toUpperCase();
  if (a === "ARM64" || a === "AARCH64") return ["windows_arm64", "windows_amd64", "windows_386"];
  if (a === "X86" || a === "I386") return ["windows_386", "windows_amd64"];
  // AMD64 / x86_64 / default
  return ["windows_amd64", "windows_arm64", "windows_386"];
}

/** GitHub API endpoint that always points at the current latest cli/cli release. */
export const GH_CLI_LATEST_RELEASE_API =
  "https://api.github.com/repos/cli/cli/releases/latest";

/**
 * PowerShell script: irm latest cli/cli release (version never pinned),
 * download the matching Windows MSI, then install via a *separate elevated*
 * msiexec process (UAC / RunAs). No per-user zip install.
 *
 * Official Windows packages: MSI + zip (we use MSI only).
 * Names: gh_<dynamic-version>_windows_{amd64|arm64|386}.msi
 *
 * Note: silent /qn without elevation commonly fails with msiexec 1603.
 * When not already admin we always launch msiexec with -Verb RunAs so Windows
 * shows a distinct UAC prompt for the install step only.
 */
export function buildWindowsIrmInstallScript(
  arch: string = process.env.PROCESSOR_ARCHITECTURE || "AMD64",
): string {
  const archPatterns = windowsGhAssetArch(arch);
  const latestApi = GH_CLI_LATEST_RELEASE_API;

  // Single -Command script. Version comes only from /releases/latest.
  return `
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ 'User-Agent' = 'getdotfiles'; 'Accept' = 'application/vnd.github+json' }

function Test-IsAdmin {
  try {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

function Find-MsiAsset($assets, $archPatterns) {
  foreach ($pat in $archPatterns) {
    $a = $assets | Where-Object { $_.name -match ('^gh_.+_' + [regex]::Escape($pat) + '\\.msi$') } | Select-Object -First 1
    if ($a) { return $a }
  }
  return $assets | Where-Object { $_.name -match '^gh_.+_windows_.+\\.msi$' } | Select-Object -First 1
}

Write-Host 'Fetching latest GitHub CLI release metadata (version is dynamic)...'
$rel = Invoke-RestMethod -Uri '${latestApi}' -Headers $headers
if (-not $rel -or -not $rel.assets) { throw 'Could not read cli/cli latest release from GitHub API' }
$tag = $rel.tag_name
Write-Host ("Latest release: " + $tag)
$archPatterns = @(${archPatterns.map((p) => `'${p}'`).join(", ")})

$msiAsset = Find-MsiAsset $rel.assets $archPatterns
if (-not $msiAsset) {
  throw ("No Windows .msi on release " + $tag + " (expected gh_<version>_windows_<arch>.msi)")
}

$msiPath = Join-Path $env:TEMP $msiAsset.name
Write-Host ("Downloading " + $msiAsset.browser_download_url)
Write-Host ("         -> " + $msiPath)
Invoke-WebRequest -Uri $msiAsset.browser_download_url -OutFile $msiPath -UseBasicParsing
if (-not (Test-Path -LiteralPath $msiPath)) { throw "Download failed: $msiPath missing" }

$log = Join-Path $env:TEMP ('gh-msi-' + [guid]::NewGuid().ToString('n') + '.log')
$isAdmin = Test-IsAdmin
# Quiet when already elevated; basic UI when elevating so the UAC path is clearer
$ui = if ($isAdmin) { '/qn' } else { '/qb' }
$msiArgs = @('/i', $msiPath, $ui, '/norestart', '/L*v', $log)

Write-Host ("Installing " + $msiAsset.name + " via msiexec (admin=" + $isAdmin + ")...")
$p = $null
if ($isAdmin) {
  $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru
} else {
  # Separate elevated process — Windows shows a UAC prompt for msiexec only
  Write-Host 'Requesting UAC elevation for msiexec (separate elevated process)...'
  try {
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru -Verb RunAs
  } catch {
    throw ("UAC elevation was cancelled or failed: " + $_.Exception.Message + ". Approve the prompt, or run an elevated terminal and retry.")
  }
}

$code = 1603
if ($null -ne $p -and $null -ne $p.ExitCode) { $code = [int]$p.ExitCode }
# 0 = success, 3010 = success reboot required
if ($code -eq 0 -or $code -eq 3010) {
  Write-Host ('GitHub CLI ' + $tag + ' MSI install finished (exit ' + $code + ').')
  exit 0
}

Write-Host ("msiexec failed with exit code " + $code + ".")
if ($code -eq 1603) {
  Write-Host 'Exit 1603 is a fatal MSI error — often UAC denied, insufficient privileges, or a conflicting install.'
}
if (Test-Path -LiteralPath $log) {
  Write-Host ("MSI log: " + $log)
  Get-Content -LiteralPath $log -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
}
throw ("msiexec failed with exit code " + $code)
`.trim();
}

/** Recipe: PowerShell irm → latest MSI → elevated msiexec (UAC). */
export function windowsIrmRecipe(
  env: NodeJS.ProcessEnv = process.env,
): GhInstallCommand {
  const script = buildWindowsIrmInstallScript(env.PROCESSOR_ARCHITECTURE || "AMD64");
  return {
    label: "PowerShell (irm latest MSI + UAC)",
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    display:
      "irm .../releases/latest → download gh_<version>_windows_*.msi → msiexec (UAC)",
    kind: "powershell-irm",
    optimistic: true,
  };
}

function windowsWingetRecipe(
  env: NodeJS.ProcessEnv,
  optimistic: boolean,
  packageId: "GitHub.cli" | "Git.Git",
): GhInstallCommand {
  const concrete = wingetCandidatePaths(env).find((p) => existsSync(p));
  const command = concrete ?? "winget";
  const labelBase = packageId === "Git.Git" ? "Git" : "GitHub CLI";
  return {
    label: optimistic
      ? `winget (Windows Package Manager) · ${labelBase}`
      : `winget · ${labelBase}`,
    command,
    args: [
      "install",
      "--id",
      packageId,
      "--source",
      "winget",
      "-e",
      "--accept-package-agreements",
      "--accept-source-agreements",
      "--disable-interactivity",
    ],
    shell: !concrete,
    display: `winget install --id ${packageId} --source winget`,
    kind: "winget",
    optimistic,
  };
}

/**
 * Pick a reasonable install recipe for Git (required before gh on many setups).
 * Windows order: winget → scoop → choco → optimistic winget.
 */
export async function resolveGitInstallCommand(
  platform: Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  deps: { execFile?: ExecFileFn } = {},
): Promise<GhInstallCommand | null> {
  const run = deps.execFile ?? defaultExecFile;

  if (platform === "darwin") {
    if (await unixHasTool(run, "brew")) {
      return {
        label: "Homebrew · Git",
        command: "brew",
        args: ["install", "git"],
        display: "brew install git",
        kind: "brew",
      };
    }
    return {
      label: "Xcode Command Line Tools",
      command: "xcode-select",
      args: ["--install"],
      display: "xcode-select --install  (provides git)",
      kind: "brew",
      optimistic: true,
    };
  }

  if (platform === "win32") {
    if (await windowsHasTool(run, "winget", env)) {
      return windowsWingetRecipe(env, false, "Git.Git");
    }
    if (await windowsHasTool(run, "scoop", env)) {
      return {
        label: "Scoop · Git",
        command: "scoop",
        args: ["install", "git"],
        display: "scoop install git",
        shell: true,
        kind: "scoop",
      };
    }
    if (await windowsHasTool(run, "choco", env)) {
      return {
        label: "Chocolatey · Git",
        command: "choco",
        args: ["install", "git", "-y"],
        display: "choco install git -y",
        shell: true,
        kind: "choco",
      };
    }
    return windowsWingetRecipe(env, true, "Git.Git");
  }

  if (await unixHasTool(run, "brew")) {
    return {
      label: "Homebrew · Git",
      command: "brew",
      args: ["install", "git"],
      display: "brew install git",
      kind: "brew",
    };
  }
  if (await unixHasTool(run, "apt-get")) {
    return {
      label: "apt · Git",
      command: "bash",
      args: ["-lc", "sudo apt-get update && sudo apt-get install -y git"],
      display: "sudo apt-get install -y git",
      kind: "apt",
    };
  }
  if (await unixHasTool(run, "dnf")) {
    return {
      label: "dnf · Git",
      command: "sudo",
      args: ["dnf", "install", "-y", "git"],
      display: "sudo dnf install -y git",
      kind: "dnf",
    };
  }
  if (await unixHasTool(run, "pacman")) {
    return {
      label: "pacman · Git",
      command: "sudo",
      args: ["pacman", "-S", "--noconfirm", "git"],
      display: "sudo pacman -S git",
      kind: "pacman",
    };
  }
  if (await unixHasTool(run, "zypper")) {
    return {
      label: "zypper · Git",
      command: "sudo",
      args: ["zypper", "--non-interactive", "install", "git"],
      display: "sudo zypper install git",
      kind: "zypper",
    };
  }

  return null;
}

/**
 * Pick a reasonable install recipe for this machine.
 * Windows order: winget → scoop → choco → PowerShell irm (latest dynamic-version .msi).
 */
export async function resolveGhInstallCommand(
  platform: Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  deps: { execFile?: ExecFileFn } = {},
): Promise<GhInstallCommand | null> {
  const run = deps.execFile ?? defaultExecFile;

  if (platform === "darwin") {
    if (await unixHasTool(run, "brew")) {
      return {
        label: "Homebrew",
        command: "brew",
        args: ["install", "gh"],
        display: "brew install gh",
        kind: "brew",
      };
    }
    return null;
  }

  if (platform === "win32") {
    if (await windowsHasTool(run, "winget", env)) {
      return windowsWingetRecipe(env, false, "GitHub.cli");
    }
    if (await windowsHasTool(run, "scoop", env)) {
      return {
        label: "Scoop",
        command: "scoop",
        args: ["install", "gh"],
        display: "scoop install gh",
        shell: true,
        kind: "scoop",
      };
    }
    if (await windowsHasTool(run, "choco", env)) {
      return {
        label: "Chocolatey",
        command: "choco",
        args: ["install", "gh", "-y"],
        display: "choco install gh -y",
        shell: true,
        kind: "choco",
      };
    }

    // Always available on real Windows: PowerShell irm + official MSI from GitHub Releases
    // https://github.com/cli/cli/blob/trunk/docs/install_windows.md (precompiled binaries)
    return windowsIrmRecipe(env);
  }

  // Linux / other Unix
  if (await unixHasTool(run, "brew")) {
    return {
      label: "Homebrew",
      command: "brew",
      args: ["install", "gh"],
      display: "brew install gh",
      kind: "brew",
    };
  }
  if (await unixHasTool(run, "apt-get")) {
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
      kind: "apt",
    };
  }
  if (await unixHasTool(run, "dnf")) {
    return {
      label: "dnf",
      command: "sudo",
      args: ["dnf", "install", "-y", "gh"],
      display: "sudo dnf install -y gh",
      kind: "dnf",
    };
  }
  if (await unixHasTool(run, "pacman")) {
    return {
      label: "pacman",
      command: "sudo",
      args: ["pacman", "-S", "--noconfirm", "github-cli"],
      display: "sudo pacman -S github-cli",
      kind: "pacman",
    };
  }
  if (await unixHasTool(run, "zypper")) {
    return {
      label: "zypper",
      command: "sudo",
      args: ["zypper", "--non-interactive", "install", "gh"],
      display: "sudo zypper install gh",
      kind: "zypper",
    };
  }

  return null;
}

async function defaultRunInstall(
  cmd: GhInstallCommand,
): Promise<{ ok: boolean; code: number | null; error?: string }> {
  const { spawn } = await import("node:child_process");
  const opts = spawnOptionsForCommand(cmd.command, {
    shell: cmd.shell ?? false,
    windowsHide: false,
  });
  return new Promise((resolve) => {
    const child = spawn(cmd.command, cmd.args, {
      stdio: "inherit",
      shell: opts.shell,
      windowsHide: opts.windowsHide,
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

/**
 * Run interactive `gh auth login` with stdio inherited.
 * On Windows, tries gh.exe first, then cmd.exe /c, then shell-wrapped .cmd —
 * never spawns a bare .cmd (that is spawn EINVAL on modern Node).
 */
export async function defaultRunAuthLogin(
  deps: GithubDeps = {},
): Promise<{ ok: boolean; error?: string }> {
  const { spawn } = await import("node:child_process");
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const candidates = ghInteractiveInvocations(platform, ["auth", "login"]);

  const errors: string[] = [];

  for (const inv of candidates) {
    const opts = spawnOptionsForCommand(inv.command, {
      shell: inv.options.shell ?? false,
      // Interactive login needs a visible console
      windowsHide: false,
    });

    const result = await new Promise<{ ok: boolean; error?: string; started?: boolean }>(
      (resolve) => {
        let settled = false;
        const done = (value: { ok: boolean; error?: string; started?: boolean }) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(inv.command, inv.args, {
            stdio: "inherit",
            shell: opts.shell,
            windowsHide: false,
            env,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          done({ ok: false, error: msg, started: false });
          return;
        }

        child.on("error", (err) => {
          done({ ok: false, error: err.message, started: false });
        });
        child.on("close", (code) => {
          // Process started; non-zero means user cancelled / login failed
          done({ ok: code === 0, started: true });
        });
      },
    );

    if (result.ok) return { ok: true };
    // If the process actually started, don't try other candidates — user saw the UI
    if (result.started) return { ok: false, error: result.error };
    if (result.error) errors.push(`${inv.command}: ${result.error}`);
  }

  const detail = errors.length > 0 ? errors.join("; ") : "could not start gh auth login";
  return {
    ok: false,
    error: detail.includes("EINVAL")
      ? `${detail} (Windows: use gh.exe or shell for .cmd; or run: gh auth login)`
      : detail,
  };
}

export const GH_INSTALL_DOCS = "https://github.com/cli/cli#installation";

export type EnsureGitResult =
  | { status: "already-installed" }
  | { status: "skipped-non-interactive" }
  | { status: "skipped-by-user" }
  | { status: "no-recipe" }
  | { status: "install-failed"; detail?: string }
  | { status: "installed" }
  | { status: "skipped" };

export type EnsureGhResult =
  | { status: "token-present" }
  | { status: "already-installed" }
  | { status: "skipped-non-interactive" }
  | { status: "skipped-by-user" }
  | { status: "no-recipe" }
  | { status: "install-failed"; detail?: string }
  | { status: "installed"; authed: boolean };

/**
 * Ensure Git is available before installing/using gh.
 * Detects existing installs (PATH + known dirs); on TTY offers package-manager install.
 */
export async function ensureGitAvailable(deps: GhInstallDeps = {}): Promise<EnsureGitResult> {
  const env = deps.env ?? process.env;
  const error = deps.error ?? console.error;
  const ask = deps.confirm ?? confirm;
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY);
  const platform = (deps.platform ?? process.platform) as Platform;

  if (deps.skipGitOffer || deps.skipOffer) return { status: "skipped" };

  if (platform === "win32") {
    const refresh = deps.refreshPath ?? refreshWindowsPath;
    await refresh(env, deps.execFile);
  }

  if (await isGitInstalled({ ...deps, env, platform })) {
    return { status: "already-installed" };
  }

  error("\nGit was not found on PATH (or known install locations).");
  error("Git is required before installing/using the GitHub CLI.");
  error(`Install docs: ${GIT_INSTALL_DOCS}\n`);

  if (!isTTY) {
    error("Non-interactive session: continuing without git.\n");
    return { status: "skipped-non-interactive" };
  }

  const recipe =
    (await deps.resolveGitInstall?.(platform, env)) ??
    (await resolveGitInstallCommand(platform, env, deps));

  if (!recipe) {
    error("No supported git install method detected.");
    error(`Install git manually from ${GIT_INSTALL_DOCS}, then retry.\n`);
    return { status: "no-recipe" };
  }

  if (recipe.optimistic) {
    error(`Install method: ${recipe.label}`);
  } else {
    error(`Detected install method: ${recipe.label}`);
  }
  error(`  ${recipe.display}\n`);

  const wantsInstall = await ask(`Install Git now via ${recipe.label}? [y/N] `, {
    isTTY: true,
  });
  if (!wantsInstall) {
    error("Skipping git install. gh auth login may fail without git.\n");
    return { status: "skipped-by-user" };
  }

  error(`\nRunning: ${recipe.display}\n`);
  const runInstall = deps.runInstall ?? defaultRunInstall;
  const installResult = await runInstall(recipe);
  if (!installResult.ok) {
    const detail =
      installResult.error ??
      (installResult.code != null ? `exit code ${installResult.code}` : "unknown error");
    error(`\nFailed to install git (${detail}).`);
    error(`See ${GIT_INSTALL_DOCS}\n`);
    return { status: "install-failed", detail };
  }

  if (platform === "win32") {
    const refresh = deps.refreshPath ?? refreshWindowsPath;
    await refresh(env, deps.execFile);
  }

  if (!(await isGitInstalled({ ...deps, env, platform }))) {
    error("\ngit install finished, but `git` is not on PATH in this session.");
    error(`Open a new terminal, or install from ${GIT_INSTALL_DOCS}\n`);
    return { status: "install-failed", detail: "git not on PATH after install" };
  }

  error("\ngit installed successfully.\n");
  return { status: "installed" };
}

/**
 * If GITHUB_TOKEN is unset and `gh` is missing, explain why it helps and
 * offer to run a platform-appropriate install (TTY only).
 *
 * Ensures git is present first (gh auth login needs it).
 * On Windows, if the first method fails (e.g. winget), automatically offers
 * PowerShell irm download of the latest release installer as a fallback.
 */
export async function ensureGhAvailable(deps: GhInstallDeps = {}): Promise<EnsureGhResult> {
  const env = deps.env ?? process.env;
  const error = deps.error ?? console.error;
  const ask = deps.confirm ?? confirm;
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY);
  const platform = (deps.platform ?? process.platform) as Platform;

  if (deps.skipOffer) return { status: "skipped-non-interactive" };
  if (hasGithubToken(env)) return { status: "token-present" };

  // Windows shells often start with a stale PATH. Refresh User+Machine PATH
  // *before* the first detection pass so an already-installed gh/git is found.
  if (platform === "win32") {
    const refresh = deps.refreshPath ?? refreshWindowsPath;
    await refresh(env, deps.execFile);
  }

  // Git first — required by gh auth login and many git-backed workflows.
  await ensureGitAvailable(deps);

  let installed = await isGhInstalled({ ...deps, env, platform });
  if (installed) return { status: "already-installed" };

  // One more Windows pass after path extras are applied (MSI default dirs).
  if (platform === "win32") {
    installed = await isGhInstalled({ ...deps, env, platform });
    if (installed) return { status: "already-installed" };
  }

  error("\nGitHub CLI (gh) was not found on PATH (or known install locations).");
  error("Without gh or GITHUB_TOKEN, API access is limited to 60 requests/hour.");
  error(`Install docs: ${GH_INSTALL_DOCS}`);
  error("Or set GITHUB_TOKEN to a personal access token.\n");

  if (!isTTY) {
    error("Non-interactive session: continuing without gh.\n");
    return { status: "skipped-non-interactive" };
  }

  const primary =
    (await deps.resolveInstall?.(platform, env)) ??
    (await resolveGhInstallCommand(platform, env, deps));

  if (!primary) {
    error("No supported install method detected.");
    error("Install gh manually, run `gh auth login`, then retry — or set GITHUB_TOKEN.\n");
    return { status: "no-recipe" };
  }

  const recipes: GhInstallCommand[] = [primary];
  // Windows: if primary is not already irm, queue irm as automatic retry target
  if (platform === "win32" && primary.kind !== "powershell-irm") {
    recipes.push(windowsIrmRecipe(env));
  }

  const runInstall = deps.runInstall ?? defaultRunInstall;
  let lastFailDetail: string | undefined;

  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i];
    if (!recipe) continue;

    if (i > 0) {
      error(`\nPrevious method failed${lastFailDetail ? ` (${lastFailDetail})` : ""}.`);
      error(`Trying fallback: ${recipe.label}`);
      error(`  ${recipe.display}\n`);
      const wantsFallback = await ask(
        `Install GitHub CLI (gh) now via ${recipe.label}? [y/N] `,
        { isTTY: true },
      );
      if (!wantsFallback) {
        error("Skipping fallback install. Continuing unauthenticated (or use GITHUB_TOKEN).\n");
        return { status: "skipped-by-user" };
      }
    } else {
      if (recipe.optimistic) {
        error(`Install method: ${recipe.label}`);
      } else {
        error(`Detected install method: ${recipe.label}`);
      }
      error(`  ${recipe.display}\n`);

      const wantsInstall = await ask(
        `Install GitHub CLI (gh) now via ${recipe.label}? [y/N] `,
        { isTTY: true },
      );
      if (!wantsInstall) {
        // If user declines winget/etc but irm is queued, offer irm once
        if (recipes.length > 1 && recipes[1]) {
          const fb = recipes[1];
          error(`\nOptional fallback: ${fb.label}`);
          error(`  ${fb.display}\n`);
          const wantsIrm = await ask(
            `Download latest gh Windows installer with PowerShell (irm) instead? [y/N] `,
            { isTTY: true },
          );
          if (!wantsIrm) {
            error("Skipping gh install. Continuing unauthenticated (or use GITHUB_TOKEN).\n");
            return { status: "skipped-by-user" };
          }
          // Jump to fallback only
          recipes.splice(0, recipes.length, fb);
          i = -1;
          continue;
        }
        error("Skipping gh install. Continuing unauthenticated (or use GITHUB_TOKEN).\n");
        return { status: "skipped-by-user" };
      }
    }

    error(`\nRunning: ${recipe.display}\n`);
    const installResult = await runInstall(recipe);
    if (!installResult.ok) {
      lastFailDetail =
        installResult.error ??
        (installResult.code != null ? `exit code ${installResult.code}` : "unknown error");
      error(`\nFailed to install gh (${lastFailDetail}).`);
      // try next recipe if any
      continue;
    }

    if (platform === "win32") {
      const refresh = deps.refreshPath ?? refreshWindowsPath;
      await refresh(env, deps.execFile);
    }

    const nowInstalled = await isGhInstalled({ ...deps, env });
    if (!nowInstalled) {
      lastFailDetail = "gh not on PATH after install";
      error("\ngh install finished, but `gh` is not on PATH in this session.");
      // try next recipe if any
      continue;
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

  if (platform === "win32") {
    error("Tips:");
    error("  • winget install --id GitHub.cli --source winget");
    error(
      "  • Or PowerShell irm latest MSI (approves a separate UAC prompt for msiexec)",
    );
    error("  • https://github.com/cli/cli/releases/latest");
    error("  • msiexec 1603 usually means UAC was denied or install lacked elevation");
    error("  • Install \"App Installer\" from the Microsoft Store (provides winget)");
    error("  • Or set GITHUB_TOKEN and re-run");
  }
  error(`See ${GH_INSTALL_DOCS} or set GITHUB_TOKEN.\n`);
  return { status: "install-failed", detail: lastFailDetail };
}

/** Test helper: confirm wrapper type re-export */
export type { ConfirmFn };
