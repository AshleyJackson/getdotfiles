import { confirm, parseArgs, USAGE } from "./cli.ts";
import { listDotfilesRepo, type GithubDeps } from "./github.ts";
import { installFile, type InstallDeps } from "./install.ts";
import { displayPath } from "./paths.ts";
import {
  InstallSummarySchema,
  type CliOptions,
  type Dotfile,
  type InstallResult,
  type InstallSummary,
  type Platform,
} from "./schemas.ts";

export class ProcessExitError extends Error {
  readonly code: number;
  override readonly name = "ProcessExitError";

  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

export type MainDeps = GithubDeps &
  InstallDeps & {
    listDotfiles?: (
      owner: string,
      repoName?: string,
      deps?: GithubDeps,
    ) => Promise<Dotfile[]>;
    install?: (
      file: Dotfile,
      options?: Parameters<typeof installFile>[1],
      deps?: InstallDeps,
    ) => Promise<InstallResult>;
    confirm?: typeof confirm;
    exit?: (code: number) => never;
    log?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    isTTY?: boolean;
    home?: string;
    platform?: Platform;
  };

function defaultExit(code: number): never {
  process.exit(code);
  throw new ProcessExitError(code);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isExitError(err: unknown): err is ProcessExitError {
  return (
    err instanceof ProcessExitError ||
    (typeof err === "object" &&
      err !== null &&
      "code" in err &&
      typeof (err as { code: unknown }).code === "number" &&
      (err as { name?: string }).name === "ProcessExitError")
  );
}

/**
 * Run install loop and return counts without exiting.
 * Exported for tests.
 */
export async function installAll(
  files: readonly Dotfile[],
  options: { force: boolean; home?: string; platform?: Platform },
  deps: MainDeps = {},
): Promise<InstallSummary> {
  const install = deps.install ?? installFile;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const home = deps.home ?? options.home;
  const platform = deps.platform ?? options.platform;

  let installed = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const result = await install(
        file,
        {
          force: options.force,
          ...(home ? { home } : {}),
          ...(platform ? { platform } : {}),
        },
        deps,
      );

      if (result.status === "skipped") {
        error(`  ⚠ skipped ~/${file.path} (${result.reason})`);
        skipped++;
        continue;
      }

      const label = result.status === "backed-up" ? "⚠" : "✓";
      log(`  ${label} ${displayPath(result.dest, home, platform)}`);
      if (result.backup) {
        log(`       backup: ${displayPath(result.backup, home, platform)}`);
      }
      installed++;
    } catch (err) {
      error(`  ✗ ~/${file.path}: ${errorMessage(err)}`);
      failed++;
    }
  }

  return InstallSummarySchema.parse({ installed, skipped, failed });
}

export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<void> {
  const exit = deps.exit ?? defaultExit;
  const error = deps.error ?? console.error;
  const log = deps.log ?? console.log;
  const list = deps.listDotfiles ?? listDotfilesRepo;
  const ask = deps.confirm ?? confirm;

  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    error(`\nError: ${errorMessage(err)}`);
    error(USAGE);
    return exit(1);
  }

  if (opts.help) {
    log(USAGE);
    return exit(0);
  }

  if (opts.username == null) {
    error(USAGE);
    return exit(1);
  }

  const username = opts.username;

  try {
    const files = await list(username, opts.repo, deps);
    if (files.length === 0) {
      error("No dotfiles found in this repo.");
      return exit(0);
    }

    error(`\nFound ${files.length} file(s) in ${username}/${opts.repo}:\n`);
    for (const f of files) error(`  ~/${f.path}`);
    error("");

    if (opts.dryRun) return exit(0);

    if (!opts.yes) {
      const ok = await ask("Write these files to ~/? [y/N] ", {
        isTTY: deps.isTTY,
      });
      error("");
      if (!ok) {
        error("Aborted.");
        return exit(1);
      }
    }

    const summary = await installAll(
      files,
      {
        force: opts.force,
        ...(deps.home ? { home: deps.home } : {}),
        ...(deps.platform ? { platform: deps.platform } : {}),
      },
      deps,
    );

    error(
      `\nDone. ${summary.installed} installed, ${summary.skipped} skipped, ${summary.failed} failed.`,
    );

    if (summary.failed > 0) return exit(1);
    if (summary.installed === 0 && summary.skipped > 0) return exit(1);
    return exit(0);
  } catch (err) {
    // Injected exit() throws for tests — rethrow so callers see the real code
    if (isExitError(err)) throw err;
    error(`\nError: ${errorMessage(err)}`);
    return exit(1);
  }
}
