# User Guide

## Quick start

```bash
npx getdotfiles <username>
```

Fetches all dotfiles from `github.com/<username>/dotfiles` and writes them to your home directory (`~/` on macOS/Linux, `%USERPROFILE%` on Windows).

The published CLI is a Node 18+ bundle. Development uses **TypeScript**, **Bun**, and **Zod** for boundary validation.

## Supported platforms

- **macOS** and **Linux** (bash, zsh, etc.)
- **Windows** (PowerShell, cmd, Git Bash) with Node.js 18+

Install target is always the user profile home directory. Nested repo paths (for example `.config/git/config`) are recreated under that home.

## Examples

### Basic usage

```bash
npx getdotfiles ashleyjackson
```

Output:
```
Found 12 file(s) in ashleyjackson/dotfiles:

  ~/.bashrc
  ~/.gitconfig
  ~/.zshrc
  ~/.config/nvim/init.lua

Write these files to ~/? [y/N] y

  ✓ ~/.bashrc
  ✓ ~/.gitconfig
  ✓ ~/.zshrc
  ✓ ~/.config/nvim/init.lua

Done. 12 installed, 0 skipped, 0 failed.
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
Found 12 file(s) in ashleyjackson/dotfiles:

  ~/.bashrc
  ~/.gitconfig
  ~/.zshrc
  ~/.config/nvim/init.lua
```

### Force overwrite

Skip backup and overwrite existing files:

```bash
npx getdotfiles ashleyjackson --force
```

### Higher rate limits

GitHub unauthenticated API allows 60 req/hr. Set a token for 5,000 req/hr:

```bash
# macOS / Linux
GITHUB_TOKEN=ghp_xxx npx getdotfiles ashleyjackson

# Windows PowerShell
$env:GITHUB_TOKEN="ghp_xxx"; npx getdotfiles ashleyjackson
```

Or log in with the GitHub CLI once (`gh auth login`); getdotfiles will use `gh auth token` automatically.

### Non-interactive / CI

When stdin is not a TTY, the confirmation prompt is not shown. Use `-y` to proceed or `--dry-run` to preview:

```bash
npx getdotfiles ashleyjackson -y
```

## Windows notes

- Paths are displayed with `~/...` even though the real location is under `%USERPROFILE%`.
- File contents are written exactly as stored in the repo (no automatic CRLF conversion).
- If a path is illegal on Windows (reserved names like `CON`/`NUL`, characters such as `:` `*` `?`, trailing dots/spaces), that file is **skipped with a warning** and the rest of the install continues.
- Prefer PowerShell or cmd with Node on PATH; `npx getdotfiles ...` works the same as on Unix.

## CLI reference

```
Usage:
  npx getdotfiles <username>                Fetch dotfiles from github.com/<username>/dotfiles
  npx getdotfiles <username> --repo <name>  Use a custom repo name
  npx getdotfiles <username> --dry-run      Preview files that would be installed
  npx getdotfiles <username> --force        Overwrite existing files without backup
  npx getdotfiles <username> -y             Skip confirmation prompt

Options:
  --repo <name>    Repository name (default: "dotfiles")
  --dry-run        Preview only, no filesystem changes
  --force          Overwrite without backup
  -y, --yes        Skip confirmation prompt
  -h, --help       Show usage
```

## FAQ

**Q: What counts as a dotfile?**
Any file whose name starts with `.` (e.g. `.bashrc`, `.gitconfig`, `.config/nvim/init.lua` — the leaf name must start with `.`).

**Q: What if a file already exists in my home directory?**
It gets backed up to `{path}.backup.{timestamp}` before the new file is written. Use `--force` to skip backup.

**Q: I hit a rate limit. What now?**
Generate a token at https://github.com/settings/tokens and set `GITHUB_TOKEN=ghp_xxx`, or run `gh auth login`.

**Q: Do I need git installed?**
No. Uses the GitHub REST API and `raw.githubusercontent.com`.

**Q: Does it handle nested directories?**
Yes. A file like `.config/nvim/init.lua` in the repo creates `~/.config/nvim/init.lua` (or `%USERPROFILE%\.config\nvim\init.lua` on Windows).

**Q: Will my line endings change on Windows?**
No. Bytes from the repo are written unchanged.

**Q: What happens if one path is invalid on Windows?**
That file is skipped and a warning is printed. Other files still install. The process exits non-zero only if every installable file failed/skipped or at least one hard failure occurred.
