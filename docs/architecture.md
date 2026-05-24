# Architecture

## Overview

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐     ┌────────────┐
│ bin/        │────>│ src/main.js  │────>│ src/      │────>│ ~/         │
│ getdotfiles │     │ (orchestrate)│     │ github.js │     │ .bashrc    │
│ (entry)     │     │              │     │ install.js│     │ .gitconfig │
└─────────────┘     └──────────────┘     └───────────┘     └────────────┘
```

## Entry point (`bin/getdotfiles.js`)

Shebang script. Passes `process.argv` to `main()` in `src/main.js`.

Built by `bun build` into `dist/getdotfiles.js` (single-file bundle).

## Orchestrator (`src/main.js`)

Three responsibilities:

1. **Arg parsing** — manual `process.argv` loop (zero-dependency). Flags: `--repo`, `--dry-run`, `--force`, `--help`.
2. **Flow control** — call discover → if not dry-run → call install. Validates username exists.
3. **Error display** — catches errors, prints friendly messages, exits 1.

## GitHub client (`src/github.js`)

Two endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /repos/{owner}/{repo}/contents/{path}` | List directory contents |
| (uses `download_url` from response) | Download raw file |

Uses global `fetch` (Node 18+). No library needed.

**Dotfile filter**: `item.type === 'file' && item.name.startsWith('.')`

**Recursive traversal**: Dirs trigger recursive `collectDotfiles()` calls. All dirs are descended (since a non-dotfile dir may contain dotfiles).

**Rate limits**:
- Unauthenticated: 60 req/hr → suggests `GITHUB_TOKEN`
- Authenticated: 5,000 req/hr

## Installer (`src/install.js`)

For each file:

1. Construct dest path: `path.join(os.homedir(), file.path)`
2. Create parent dirs if needed
3. If dest exists and not `--force`: rename to `{path}.backup.{timestamp}`
4. Fetch raw content from `download_url`
5. Write file
6. Return result (installed / backed-up)

## Bundle (`bun build`)

`bun build ./bin/getdotfiles.js --target=node` produces a single `dist/getdotfiles.js` (5.2 KB) that inlines all `src/` modules. Published to npm, used by `npx`.

## Data flow

```
CLI args
  │
  ▼
parseArgs() → { username, repo, dryRun, force }
  │
  ▼
listDotfilesRepo(user, repo)    ← GitHub API (recursive)
  │
  ▼
Array<{ path, name, download_url }>
  │
  ├── dry-run? → print paths, exit 0
  │
  └── install? → installDotfiles(files, { force })
                    │
                    ▼
                  for each file:
                    check ~/{path}
                    ├── exists + !force → backup, write
                    ├── exists + force → overwrite
                    └── not exists → write
                    │
                    ▼
                  print results
```

## Error handling matrix

| Scenario | Response |
|----------|----------|
| No username | Print usage, exit 1 |
| Repo 404 | "Repo not found", exit 1 |
| Rate limited (403) | Suggest GITHUB_TOKEN, exit 1 |
| Network error | Error message, exit 1 |
| No dotfiles found | Message, exit 0 |
| File write fails | Error message, exit 1 |