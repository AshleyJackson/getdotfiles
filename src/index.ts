/**
 * Public API for programmatic use.
 * CLI entry remains `bin/getdotfiles.ts` → `dist/getdotfiles.js`.
 */

export { confirm, parseArgs, USAGE, type ConfirmFn } from "./cli.ts";
export {
  ensureGhAvailable,
  GH_INSTALL_DOCS,
  hasGithubToken,
  isGhInstalled,
  resolveGhInstallCommand,
  type EnsureGhResult,
  type GhInstallCommand,
  type GhInstallDeps,
} from "./gh-install.ts";
export {
  collectDotfiles,
  fetchContents,
  getRawUrl,
  getToken,
  ghTokenInvocations,
  isDotfile,
  listDotfilesRepo,
  type ExecFileFn,
  type FetchFn,
  type GithubDeps,
} from "./github.ts";
export { downloadFile, installFile, type InstallDeps } from "./install.ts";
export {
  installAll,
  main,
  ProcessExitError,
  type MainDeps,
} from "./main.ts";
export {
  displayPath,
  isValidWindowsSegment,
  resolveHomePath,
  splitRepoPath,
  validateRepoPath,
} from "./paths.ts";
export {
  CliOptionsSchema,
  DotfileListSchema,
  DotfileSchema,
  GitHubContentItemSchema,
  GitHubContentsResponseSchema,
  GitHubNameSchema,
  InstallOptionsSchema,
  InstallResultSchema,
  InstallSummarySchema,
  PathSplitResultSchema,
  PlatformSchema,
  ResolveHomeResultSchema,
  type CliOptions,
  type CliOptionsInput,
  type Dotfile,
  type DotfileList,
  type GitHubContentItem,
  type GitHubContentsResponse,
  type InstallOptions,
  type InstallOptionsParsed,
  type InstallResult,
  type InstallSummary,
  type PathSplitResult,
  type Platform,
  type ResolveHomeResult,
} from "./schemas.ts";
