# Agent guidelines — getdotfiles

## Stack (required)

- **Runtime / package manager:** Bun
- **Language:** TypeScript only (no new plain JavaScript sources)
- **Validation:** Zod for all external and boundary data
- **Tests:** `bun:test` under `tests/`
- **Ship artifact:** single-file Node-compatible bundle in `dist/` via `bun build`

## Bun defaults

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.ts>` instead of webpack/esbuild CLI directly
- Use `bun install` / `bun add` / `bun remove` instead of npm/yarn/pnpm
- Use `bun run <script>` instead of `npm run`
- Use `bunx <package>` instead of `npx` when invoking local tooling
- Bun loads `.env` automatically — do not add `dotenv`

## TypeScript

- All application code lives in `src/**/*.ts` and `bin/**/*.ts`
- Prefer `.ts` imports with extensions (`./foo.ts`) to match `allowImportingTsExtensions`
- Keep `strict` mode on; do not weaken `tsconfig.json` to silence errors
- Model public shapes with Zod schemas in `src/schemas.ts`, then `z.infer<>` for types
- Do not introduce `any` unless unavoidable at a true boundary; prefer `unknown` + Zod parse
- CLI entry: `bin/getdotfiles.ts` → `src/main.ts`
- Published binary is the bundled `dist/getdotfiles.js` (Node target) for `npx` users

## Zod (always)

Use Zod at every trust boundary:

| Boundary | Schema location / examples |
|----------|----------------------------|
| CLI argv | `CliOptionsSchema` via `parseArgs` in `src/cli.ts` |
| GitHub API JSON | `GitHubContentsResponseSchema`, `GitHubContentItemSchema` |
| Dotfile records | `DotfileSchema`, `DotfileListSchema` |
| Install I/O results | `InstallResultSchema`, `InstallSummarySchema` |
| Path outcomes | `PathSplitResultSchema`, `ResolveHomeResultSchema` |

Rules:

- Parse (or `safeParse`) untrusted input before use — never trust `res.json()` or argv shape raw
- Prefer `z.discriminatedUnion` for result/status objects
- Export both schemas and inferred types from `src/schemas.ts`
- On parse failure at the CLI edge, print a clear error and non-zero exit

## Project layout

```
bin/getdotfiles.ts      # CLI entry (bun)
src/
  schemas.ts            # Zod schemas + inferred types
  cli.ts                # argv parsing, confirm prompt, USAGE
  paths.ts              # cross-platform path split/validate/display
  github.ts             # GitHub API + gh token resolution
  install.ts            # download + write under homedir
  main.ts               # orchestration
tests/                  # bun:test suite (wide coverage)
docs/                   # architecture + user guide
dist/getdotfiles.js     # bundled publish artifact
```

## Cross-platform behavior

- Install root is always `os.homedir()` (`~/` / `%USERPROFILE%`) — no AppData remapping
- Preserve remote file bytes exactly (no LF↔CRLF conversion)
- Windows invalid paths: best-effort **skip + warn**, continue other files
- Windows `gh` auth: try `gh.cmd` / `gh.exe` / `gh` / shell fallback
- Non-interactive stdin: do not hang on confirm; require `-y` or `--dry-run`

## Commands

```bash
bun install
bun test
bun run typecheck
bun run build
bun run dev -- <username> --dry-run
bun run check          # syntax-check dist bundle
```

## Testing

- Put tests in `tests/**/*.test.ts` (not next to `src/` files)
- Use shared fixtures from `tests/helpers.ts`
- Prefer dependency injection (`fetch`, `execFile`, `listDotfiles`, `install`, `exit`) over mocking globals
- Cover: schemas, paths (posix + win32), CLI parsing, GitHub client errors/auth, install (temp dirs), main flow/exit codes
- Run with:

```ts
import { describe, expect, test } from "bun:test";

test("example", () => {
  expect(1).toBe(1);
});
```

## APIs / dependencies

- Prefer Bun/Node built-ins: `fetch`, `node:fs/promises`, `node:path`, `node:os`, `node:child_process`
- Do not add Express, axios, commander, etc. without a strong reason
- `zod` is the standard validation library for this repo
- Prefer `Bun.file` / `Bun.$` in Bun-only tooling scripts; keep the published CLI Node-compatible via `bun build --target=node`

## Docs

When behavior changes, update:

- `README.md` — user-facing usage
- `docs/guide.md` — detailed guide / FAQ
- `docs/architecture.md` — module responsibilities and data flow
- `AGENTS.md` — only when agent/contributor conventions change

## Do not

- Commit secrets or real `GITHUB_TOKEN` values
- Add JavaScript source files under `src/` or `bin/`
- Skip Zod validation for new external inputs
- Convert line endings on install
- Use `git commit --no-verify` or force-push unless explicitly requested
