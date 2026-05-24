import { createInterface } from "node:readline";
import { listDotfilesRepo } from "./github.js";
import { installDotfiles } from "./install.js";

const USAGE = `
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

function parseArgs(args) {
  const opts = {
    username: null,
    repo: "dotfiles",
    dryRun: false,
    force: false,
    yes: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--repo":
        opts.repo = args[++i] || "dotfiles";
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--force":
        opts.force = true;
        break;
      case "-y":
      case "--yes":
        opts.yes = true;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
      default:
        if (!opts.username) {
          opts.username = args[i];
        }
    }
  }

  return opts;
}

/**
 * Prompt user for confirmation via stdin.
 * Returns true if they confirm.
 */
async function confirm(msg) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(msg, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

export async function main(argv) {
  const opts = parseArgs(argv);

  if (!opts.username) {
    console.error(USAGE);
    process.exit(1);
  }

  try {
    console.error(`Fetching dotfiles from ${opts.username}/${opts.repo}...`);
    const files = await listDotfilesRepo(opts.username, opts.repo);

    if (files.length === 0) {
      console.error("No dotfiles found in this repo.");
      process.exit(0);
    }

    console.error(`\nFound ${files.length} file(s):\n`);
    for (const f of files) {
      console.error(`  ~/${f.path}`);
    }
    console.error("");

    if (opts.dryRun) {
      process.exit(0);
    }

    if (!opts.yes) {
      const ok = await confirm("Write these files to ~/? [y/N] ");
      if (!ok) {
        console.error("Aborted.");
        process.exit(1);
      }
    }

    console.error(`Installing ${files.length} file(s) to ~/...\n`);
    const results = await installDotfiles(files, { force: opts.force });

    for (const r of results) {
      const label = r.status === "backed-up" ? "⚠" : "✓";
      console.log(`  ${label} ~/${r.dest.replace(process.env.HOME || "~", "~")}`);
      if (r.backup) {
        console.log(`       backup: ${r.backup.replace(process.env.HOME || "~", "~")}`);
      }
    }

    console.error("\nDone.");
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}