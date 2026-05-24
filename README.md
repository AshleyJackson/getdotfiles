# getdotfiles

Fetch dotfiles from a GitHub user's dotfiles repo and install them to your home directory.

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

## How it works

1. Lists root contents of `github.com/<username>/dotfiles` via the GitHub API
2. Recursively finds all files whose name starts with `.` (dotfiles)
3. Downloads each file from `raw.githubusercontent.com`
4. Writes each file to `~/` preserving its repo path

## Rate limits

Unauthenticated GitHub API allows 60 requests per hour. Set `GITHUB_TOKEN` env var for 5,000 req/hr:

```bash
GITHUB_TOKEN=ghp_xxx npx getdotfiles ashleyjackson
```

## Existing files

If a target file already exists in your home directory, it's backed up with a `.backup.{timestamp}` suffix before being overwritten. Use `--force` to skip backup.

## License

MIT