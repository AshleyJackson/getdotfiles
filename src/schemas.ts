import { z } from "zod";

/** Loose platform label — accepts NodeJS.Platform and test doubles. */
export const PlatformSchema = z.string().min(1);
export type Platform = z.infer<typeof PlatformSchema>;

/** CLI options after argv parsing. */
export const CliOptionsSchema = z.object({
  username: z.string().min(1).nullable(),
  repo: z.string().min(1).default("dotfiles"),
  dryRun: z.boolean().default(false),
  force: z.boolean().default(false),
  yes: z.boolean().default(false),
  help: z.boolean().default(false),
});
export type CliOptions = z.infer<typeof CliOptionsSchema>;
export type CliOptionsInput = z.input<typeof CliOptionsSchema>;

/** A single installable dotfile discovered from GitHub. */
export const DotfileSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  download_url: z.string().url(),
});
export type Dotfile = z.infer<typeof DotfileSchema>;

export const DotfileListSchema = z.array(DotfileSchema);
export type DotfileList = z.infer<typeof DotfileListSchema>;

/** GitHub Contents API item (file or dir). */
export const GitHubContentItemSchema = z.object({
  type: z.enum(["file", "dir", "symlink", "submodule"]),
  name: z.string().min(1),
  path: z.string().min(1),
  download_url: z.string().url().nullable().optional(),
  sha: z.string().optional(),
  size: z.number().optional(),
  url: z.string().url().optional(),
  html_url: z.string().url().nullable().optional(),
  git_url: z.string().url().nullable().optional(),
});
export type GitHubContentItem = z.infer<typeof GitHubContentItemSchema>;

/** Contents endpoint may return one item or an array. */
export const GitHubContentsResponseSchema = z.union([
  z.array(GitHubContentItemSchema),
  GitHubContentItemSchema,
]);
export type GitHubContentsResponse = z.infer<typeof GitHubContentsResponseSchema>;

/** Result of installing one file. */
export const InstallResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("installed"),
    dest: z.string().min(1),
    backup: z.null(),
  }),
  z.object({
    status: z.literal("backed-up"),
    dest: z.string().min(1),
    backup: z.string().min(1),
  }),
  z.object({
    status: z.literal("skipped"),
    dest: z.null(),
    backup: z.null(),
    reason: z.string().min(1),
  }),
]);
export type InstallResult = z.infer<typeof InstallResultSchema>;

export const InstallOptionsSchema = z.object({
  force: z.boolean().optional().default(false),
  home: z.string().min(1).optional(),
  platform: PlatformSchema.optional(),
});
/** Input accepted by installFile (defaults applied inside). */
export type InstallOptions = z.input<typeof InstallOptionsSchema>;
export type InstallOptionsParsed = z.infer<typeof InstallOptionsSchema>;

/** Path split / validation outcomes. */
export const PathSplitOkSchema = z.object({
  ok: z.literal(true),
  segments: z.array(z.string().min(1)).min(1),
  reason: z.null(),
});
export const PathSplitErrSchema = z.object({
  ok: z.literal(false),
  segments: z.array(z.string()),
  reason: z.string().min(1),
});
export const PathSplitResultSchema = z.discriminatedUnion("ok", [
  PathSplitOkSchema,
  PathSplitErrSchema,
]);
export type PathSplitResult = z.infer<typeof PathSplitResultSchema>;

export const ResolveHomeOkSchema = z.object({
  ok: z.literal(true),
  dest: z.string().min(1),
  reason: z.null(),
});
export const ResolveHomeErrSchema = z.object({
  ok: z.literal(false),
  dest: z.null(),
  reason: z.string().min(1),
});
export const ResolveHomeResultSchema = z.discriminatedUnion("ok", [
  ResolveHomeOkSchema,
  ResolveHomeErrSchema,
]);
export type ResolveHomeResult = z.infer<typeof ResolveHomeResultSchema>;

export const InstallSummarySchema = z.object({
  installed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type InstallSummary = z.infer<typeof InstallSummarySchema>;

/** GitHub owner / repo name constraints (practical subset). */
export const GitHubNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9._-])*$/, {
    message: "invalid GitHub name",
  });
