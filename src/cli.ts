import { z } from "zod";
import { CliOptionsSchema, type CliOptions } from "./schemas.ts";

export const USAGE = `
Usage:
  npx getdotfiles <username>                Fetch dotfiles from github.com/<username>/dotfiles
  npx getdotfiles <username> --repo <name>  Use a custom repo name
  npx getdotfiles <username> --dry-run      Preview files that would be installed
  npx getdotfiles <username> --force        Overwrite existing files without backup
  npx getdotfiles <username> -y             Skip confirmation prompt

Examples:
  npx getdotfiles ashleyjackson
  npx getdotfiles ashleyjackson --repo my-configs
  npx getdotfiles ashleyjackson --dry-run
`;

const RawArgsSchema = z.object({
  username: z.string().min(1).nullable(),
  repo: z.string().min(1),
  dryRun: z.boolean(),
  force: z.boolean(),
  yes: z.boolean(),
  help: z.boolean(),
});

/**
 * Parse CLI argv (without node/bun executable or script path).
 * Throws ZodError if the resulting options fail schema validation.
 */
export function parseArgs(args: readonly string[]): CliOptions {
  const raw = {
    username: null as string | null,
    repo: "dotfiles",
    dryRun: false,
    force: false,
    yes: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--repo": {
        const next = args[++i];
        raw.repo = next && !next.startsWith("-") ? next : "dotfiles";
        break;
      }
      case "--dry-run":
        raw.dryRun = true;
        break;
      case "--force":
        raw.force = true;
        break;
      case "-y":
      case "--yes":
        raw.yes = true;
        break;
      case "--help":
      case "-h":
        raw.help = true;
        break;
      default:
        if (arg && !arg.startsWith("-") && !raw.username) {
          raw.username = arg;
        }
        break;
    }
  }

  const parsed = RawArgsSchema.parse(raw);
  return CliOptionsSchema.parse(parsed);
}

export type ConfirmFn = (message: string) => Promise<boolean>;

/**
 * Ask the user to confirm. Returns false immediately when stdin is not a TTY.
 */
export async function confirm(
  msg: string,
  options: {
    isTTY?: boolean | undefined;
    question?: ConfirmFn;
  } = {},
): Promise<boolean> {
  const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY);
  if (!isTTY) {
    console.error("No TTY detected; re-run with -y to confirm, or --dry-run to preview.");
    return false;
  }

  if (options.question) {
    return options.question(msg);
  }

  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(msg, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}
