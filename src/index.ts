/**
 * Public API for programmatic use.
 * CLI entry remains `bin/getdotfiles.ts` → `dist/getdotfiles.js`.
 */

export { confirm, parseArgs, USAGE, type ConfirmFn } from "./cli.ts";
export {
  buildWindowsIrmInstallScript,
  defaultRunAuthLogin,
  ensureGhAvailable,
  ensureGitAvailable,
  GH_CLI_LATEST_RELEASE_API,
  GH_INSTALL_DOCS,
  GIT_INSTALL_DOCS,
  ghCandidatePaths,
  gitCandidatePaths,
  hasGithubToken,
  isCliToolInstalled,
  isGhInstalled,
  isGitInstalled,
  isWindowsBatchShim,
  refreshWindowsPath,
  resolveGhInstallCommand,
  resolveGitInstallCommand,
  spawnOptionsForCommand,
  windowsGhAssetArch,
  windowsIrmRecipe,
  wingetCandidatePaths,
  type EnsureGhResult,
  type EnsureGitResult,
  type GhInstallCommand,
  type GhInstallDeps,
} from "./gh-install.ts";
export {
  collectDotfiles,
  fetchContents,
  getRawUrl,
  getToken,
  ghInteractiveInvocations,
  ghTokenInvocations,
  isDotfile,
  isUnderDotPath,
  listDotfilesRepo,
  type ExecFileFn,
  type FetchFn,
  type GhInvocation,
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
