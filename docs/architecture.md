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
| Windows gh | Prefer `gh.exe` → `gh` → `gh.cmd` **with `shell: true`** (Node CVE-2024-27980: bare `.cmd` spawn → **EINVAL**) |
| Detect installed | `isGhInstalled`: PATH names → `ghCandidatePaths` (MSI/scoop/choco/brew paths) → `where`/`which`. Windows refreshes PATH first |
| Interactive login | `ghInteractiveInvocations` / `defaultRunAuthLogin` — stdio inherit; Windows tries `gh.exe`, then `cmd.exe /c gh`, then shell-wrapped `.cmd` |
| Dotfile filter | `type === 'file'` && `name.startsWith('.')` |
| DI | `GithubDeps`: `fetch`, `execFile`, `env`, `platform` |

## GitHub CLI bootstrap (`src/gh-install.ts`)

Called from `main()` before listing when useful:

1. Skip if `GITHUB_TOKEN` set
2. **Ensure Git first** (`ensureGitAvailable`): detect via PATH + `gitCandidatePaths`; TTY offers install (winget `Git.Git` / brew / apt / …)
3. **Auto-detect existing gh** (Windows: refresh User+Machine PATH first, then probe PATH + known install dirs). If found → `already-installed`, no prompt
4. Explain rate-limit impact + docs link when missing
5. Non-TTY → continue without install
6. TTY → resolve package manager recipe → confirm → run install → optional `gh auth login`

Recipes: brew (macOS/Linux), winget/scoop/choco (Windows), apt (official GitHub CLI repo), dnf, pacman, zypper. Git uses the same managers (`Git.Git` on winget).

Windows notes:

- Detect tools via multiple probes (`tool --version`, `.exe`/`.cmd`, `where.exe`, `shell: true`, known `WindowsApps\\winget.exe` paths)
- Order: winget → scoop → choco → **PowerShell irm MSI** (`windowsIrmRecipe`)
- irm path always hits `/repos/cli/cli/releases/latest` and matches `gh_.+_windows_<arch>.msi` — **gh version numbers are never hardcoded**
- MSI only (no per-user zip). When not already admin, msiexec is started with `-Verb RunAs` so Windows shows a **separate UAC prompt**; uses `/qb` while elevating (silent `/qn` without elevation often returns **1603**)
- If winget is chosen first and fails or is declined, automatically offer the irm MSI fallback
- After install, `refreshWindowsPath()` reloads User+Machine PATH and adds the MSI install dirs so `gh` resolves in the same session
- `spawnOptionsForCommand` forces `shell: true` for `.cmd`/`.bat` so install/`gh auth login` never hit **spawn EINVAL** on modern Node

## Installer (`src/install.ts`)

1. Zod-parse `Dotfile` + `InstallOptions`
2. `resolveHomePath` — may return skipped on invalid Windows paths
3. `mkdir` recursive
4. Backup dest unless `--force`
5. Download **bytes** (`arrayBuffer` → `Buffer`) — no LF/CRLF conversion
6. Write file; return Zod-validated `InstallResult`

## Build (`bun run build` → `scripts/build.ts`)

1. **CLI bundle** — `bun build ./bin/getdotfiles.ts --target=node` → `dist/getdotfiles.js` (Zod inlined)
2. **Node shebang normalize** — force `#!/usr/bin/env node` and strip `// @bun` (bun build otherwise keeps a bun shebang, which breaks Windows/`npx`)
3. **Library bundle** — `bun build ./src/index.ts --target=node --packages=external` → `dist/index.js` (Zod external)
4. **Declarations** — `tsc -p tsconfig.build.json` → `dist/*.d.ts` (+ `.d.ts.map`)
5. **Specifier rewrite** — declaration imports `from "./foo.ts"` → `from "./foo.js"` for consumers

`bun run check` fails the build if the CLI header still mentions bun.

`package.json` points consumers at types:

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

`prepack` sets the CLI executable bit portably.

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
