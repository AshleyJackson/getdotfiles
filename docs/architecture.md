# Architecture

## Overview

```
┌─────────────────┐     ┌──────────────┐     ┌────────────┐     ┌──────────────┐
│ bin/            │────>│ src/main.ts  │────>│ src/       │────>│ ~/ or        │
│ getdotfiles.ts  │     │ (orchestrate)│     │ github.ts  │     │ %USERPROFILE%│
│ (entry)         │     │              │     │ install.ts │     │ .bashrc      │
└─────────────────┘     └──────────────┘     │ paths.ts   │     │ .gitconfig   │
                                             │ schemas.ts │     └──────────────┘
                                             │ cli.ts     │
                                             └────────────┘
```

## Entry point (`bin/getdotfiles.ts`)

Bun-friendly CLI entry. Passes `process.argv` to `main()` in `src/main.ts`.

Built by `bun build --target=node` into `dist/getdotfiles.js` (single-file bundle with Zod inlined) for `npx` / Node users.

## Orchestrator (`src/main.ts`)

1. **Arg parsing** — `parseArgs` returns Zod-validated `CliOptions`
2. **Flow control** — discover → preview → confirm → install
3. **Best-effort install** — `installAll` per-file try/catch with skip/fail counts
4. **Non-interactive safety** — no TTY without `-y` aborts
5. **Testability** — `MainDeps` injects `fetch`, list, install, exit, logging

## Schemas (`src/schemas.ts`)

All boundary types are Zod schemas; TypeScript types come from `z.infer<>`.

| Schema | Role |
|--------|------|
| `CliOptionsSchema` | CLI flags |
| `DotfileSchema` | Installable file record |
| `GitHubContentsResponseSchema` | API list/file payload |
| `InstallResultSchema` | installed / backed-up / skipped |
| `PathSplitResultSchema` / `ResolveHomeResultSchema` | Path outcomes |
| `InstallSummarySchema` | Run aggregates |

## CLI (`src/cli.ts`)

- Manual `argv` loop (no CLI framework)
- Validates through Zod
- `confirm()` supports injected question fn + TTY guard
- `USAGE` string

## Path helpers (`src/paths.ts`)

| Helper | Role |
|--------|------|
| `splitRepoPath` | Normalize GitHub `/` paths; reject absolute + `..` |
| `validateRepoPath` | On win32, reject illegal/reserved segments |
| `resolveHomePath` | `path.join(homedir(), ...segments)` |
| `displayPath` | `~/...` with `/`; case-insensitive home on Windows |

Install root is always `os.homedir()`.

## GitHub client (`src/github.ts`)

| Concern | Details |
|---------|---------|
| API | `GET /repos/{owner}/{repo}/contents/{path}` + `download_url` |
| Validation | Response parsed with `GitHubContentsResponseSchema` |
| Auth order | 1) `GITHUB_TOKEN` 2) `gh auth token` |
| Windows gh | `gh.cmd` → `gh.exe` → `gh` → shell fallback |
| Dotfile filter | `type === 'file'` && `name.startsWith('.')` |
| DI | `GithubDeps`: `fetch`, `execFile`, `env`, `platform` |

## Installer (`src/install.ts`)

1. Zod-parse `Dotfile` + `InstallOptions`
2. `resolveHomePath` — may return skipped on invalid Windows paths
3. `mkdir` recursive
4. Backup dest unless `--force`
5. Download **bytes** (`arrayBuffer` → `Buffer`) — no LF/CRLF conversion
6. Write file; return Zod-validated `InstallResult`

## Bundle (`bun build`)

```bash
bun build ./bin/getdotfiles.ts --target=node --outfile=./dist/getdotfiles.js
```

Produces a Node 18+ CLI for `npx`. `prepack` sets the executable bit portably.

## Data flow

```
CLI args
  → parseArgs() (Zod)
  → { username, repo, dryRun, force, yes, help }
  → listDotfilesRepo()  ← GitHub API (Zod)
  → Dotfile[]
  → dry-run? print, exit 0
  → !yes? confirm (TTY / -y)
  → installAll() per file
  → summary → exit code
```

## Error handling matrix

| Scenario | Response |
|----------|----------|
| No username / help | Usage; exit 1 / 0 |
| Repo 404 / 403 / 5xx | Friendly message, exit 1 |
| Zod API shape error | Throw with parse detail |
| Invalid path on Windows | Skip + warn; continue |
| Single file failure | ✗; continue; exit 1 if any failed |
| All skipped | Exit 1 |
| No TTY without `-y` | Abort, exit 1 |

## Tests (`tests/`)

| File | Covers |
|------|--------|
| `schemas.test.ts` | Zod schema accept/reject |
| `paths.test.ts` | Posix/Windows path rules |
| `cli.test.ts` | argv, confirm TTY |
| `github.test.ts` | auth, errors, recursion, filters |
| `install.test.ts` | temp dir writes, backup, skips, bytes |
| `main.test.ts` | flow, exit codes, best-effort counts |

Helpers and DI live in `tests/helpers.ts`.
