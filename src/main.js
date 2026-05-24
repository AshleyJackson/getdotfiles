import { listDotfilesRepo } from "./github.js";
import { installDotfiles } from "./install.js";

const USAGE = `
Usage:
  npx getdotfiles <username>                Fetch dotfiles from github.com/<username>/dotfiles
  npx getdotfiles <username> --repo <name>  Use a custom repo name
  npx getdotfiles <username> --dry-run      Preview files that would be installed
  npx getdotfiles <username> --force        Overwrite existing files without backup

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

    if (opts.dryRun) {
      console.error(`\nWould install ${files.length} file(s) to ~/:\n`);
      for (const f of files) {
        console.log(`  ~/${f.path}`);
      }
      console.error("\nUse --force to overwrite existing files without backup.");
      process.exit(0);
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