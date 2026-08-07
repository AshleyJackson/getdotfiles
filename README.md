# getdotfiles

Fetch dotfiles from a GitHub user's dotfiles repo and install them to your home directory.

Works on **macOS**, **Linux**, and **Windows**.

**Requirement:** [Node.js 18+](https://nodejs.org/) only. Bun is **not** required for end users — `npx getdotfiles` runs on Node.

Built with TypeScript + Zod; published as Node-compatible bundles **with declaration files** (`dist/*.d.ts`) for `npx` and programmatic imports.

```
npx getdotfiles <username>
```

## Usage

```bash
# Fetch from github.com/username/dotfiles
npx getdotfiles ashleyjackson

# Use a custom repo
npx getdotfiles ashleyjackson --repo my-configs

# Preview without installing
npx getdotfiles ashleyjackson --dry-run

# Overwrite existing files without backup
npx getdotfiles ashleyjackson --force

# Skip confirmation prompt
npx getdotfiles ashleyjackson -y
```

On Windows (PowerShell or cmd) — install [Node.js LTS](https://nodejs.org/) first (includes `npx`):

```powershell
# Verify Node is available (should print v18+)
node -v
npx getdotfiles ashleyjackson
npx getdotfiles ashleyjackson --dry-run
$env:GITHUB_TOKEN="ghp_xxx"; npx getdotfiles ashleyjackson -y
```

You do **not** need Bun, Git, or the GitHub CLI to start. If `gh` is missing, an interactive run can offer to install it for higher API rate limits.

## How it works

1. Lists root contents of `github.com/<username>/dotfiles` via the GitHub API
2. Recursively finds all files whose name starts with `.` (dotfiles)
3. Downloads each file from `raw.githubusercontent.com` (bytes preserved as-is)
4. Writes each file under your home directory (`~/` / `%USERPROFILE%`), preserving repo path segments

## Platform notes

| Topic | Behavior |
|-------|----------|
| Install root | Always the user home directory (`os.homedir()` → `~/` or `%USERPROFILE%`) |
| Paths | Repo paths use `/`; they are joined with the OS path separator on write |
| Invalid Windows paths | Best-effort: illegal names (e.g. `CON`, `foo:bar`) are **skipped with a warning**; other files still install |
| Line endings | Preserved exactly from the repo (no LF↔CRLF conversion) |
| Auth | `GITHUB_TOKEN`, or the GitHub CLI (`gh auth token`) when available |
| Missing `gh` | On a TTY, offers to install GitHub CLI via brew / winget / apt / etc., then optional `gh auth login` |
| Non-interactive | Without a TTY, no install/write prompts — set `GITHUB_TOKEN`, or install `gh` yourself; use `-y` / `--dry-run` |

## Rate limits

Unauthenticated GitHub API allows 60 requests per hour. Set `GITHUB_TOKEN` env var for 5,000 req/hr:

```bash
# macOS / Linux
GITHUB_TOKEN=ghp_xxx npx getdotfiles ashleyjackson

# Windows PowerShell
$env:GITHUB_TOKEN="ghp_xxx"; npx getdotfiles ashleyjackson
```

If the [GitHub CLI](https://cli.github.com/) is installed and logged in (`gh auth login`), its token is used automatically when `GITHUB_TOKEN` is unset.

If `gh` is missing and no token is set, an interactive session will detect that and **offer to install** it (Homebrew, winget/Scoop/Chocolatey, apt/dnf/pacman/zypper when available), then optionally run `gh auth login`.

## Existing files

If a target file already exists in your home directory, it's backed up with a `.backup.{timestamp}` suffix before being overwritten. Use `--force` to skip backup.

## License

MIT
