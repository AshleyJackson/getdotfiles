# User Guide

## Quick start

```bash
npx getdotfiles <username>
```

Fetches all dotfiles from `github.com/<username>/dotfiles` and writes them to `~/`.

## Examples

### Basic usage

```bash
npx getdotfiles ashleyjackson
```

Output:
```
Fetching dotfiles from ashleyjackson/dotfiles...
Installing 12 file(s) to ~/...

  ✓ ~/.bashrc
  ✓ ~/.gitconfig
  ✓ ~/.zshrc
  ✓ ~/.config/nvim/init.lua

Done.
```

### Custom repo

```bash
npx getdotfiles ashleyjackson --repo my-configs
```

Fetches from `github.com/ashleyjackson/my-configs` instead of `dotfiles`.

### Dry run

Preview what would be installed without touching disk:

```bash
npx getdotfiles ashleyjackson --dry-run
```

```
Fetching dotfiles from ashleyjackson/dotfiles...

Would install 12 file(s) to ~/:

  ~/.bashrc
  ~/.gitconfig
  ~/.zshrc
  ~/.config/nvim/init.lua

Use --force to overwrite existing files without backup.
```

### Force overwrite

Skip backup and overwrite existing files:

```bash
npx getdotfiles ashleyjackson --force
```

### Higher rate limits

GitHub unauthenticated API allows 60 req/hr. Set a token for 5,000 req/hr:

```bash
GITHUB_TOKEN=ghp_xxx npx getdotfiles ashleyjackson
```

## CLI reference

```
Usage:
  npx getdotfiles <username>                Fetch dotfiles from github.com/<username>/dotfiles
  npx getdotfiles <username> --repo <name>  Use a custom repo name
  npx getdotfiles <username> --dry-run      Preview files that would be installed
  npx getdotfiles <username> --force        Overwrite existing files without backup

Options:
  --repo <name>    Repository name (default: "dotfiles")
  --dry-run        Preview only, no filesystem changes
  --force          Overwrite without backup
  -h, --help       Show usage
```

## FAQ

**Q: What counts as a dotfile?**
Any file whose name starts with `.` (e.g. `.bashrc`, `.gitconfig`, `.config/nvim/init.lua`).

**Q: What if a file already exists in `~/`?**
It gets backed up to `{path}.backup.{timestamp}` before the new file is written. Use `--force` to skip backup.

**Q: I hit a rate limit. What now?**
Generate a token at https://github.com/settings/tokens and set `GITHUB_TOKEN=ghp_xxx`.

**Q: Do I need git installed?**
No. Uses the GitHub REST API and `raw.githubusercontent.com`.

**Q: Does it handle nested directories?**
Yes. A file like `.config/nvim/init.lua` in the repo creates `~/.config/nvim/init.lua`.