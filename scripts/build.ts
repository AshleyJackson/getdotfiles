#!/usr/bin/env bun
/**
 * Build:
 * 1. Bundle CLI + library entry for Node (npx / Windows must not require Bun)
 * 2. Normalize CLI shebang to `#!/usr/bin/env node` and strip Bun-only markers
 * 3. Emit .d.ts (+ .d.ts.map) via tsc
 * 4. Rewrite `.ts` import specifiers in declarations to `.js` for consumers
 */
import { chmodSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

async function run(cmd: string[], label: string): Promise<void> {
  console.error(`> ${label}`);
  const proc = Bun.spawn(cmd, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${label} failed with exit ${code}`);
  }
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

/**
 * Declaration emit keeps `from "./foo.ts"` because of allowImportingTsExtensions.
 * Package consumers resolve `.js` (or extensionless); rewrite to `.js`.
 */
function rewriteTsSpecifiers(source: string): string {
  return source
    .replace(/(from\s+["'])([^"']+)\.ts(["'])/g, "$1$2.js$3")
    .replace(/(import\s*\(\s*["'])([^"']+)\.ts(["']\s*\))/g, "$1$2.js$3")
    .replace(/(export\s+\*\s+from\s+["'])([^"']+)\.ts(["'])/g, "$1$2.js$3");
}

async function fixDeclarationImports(): Promise<number> {
  const files = (await walk(dist)).filter(
    (f) => f.endsWith(".d.ts") || f.endsWith(".d.ts.map"),
  );
  let changed = 0;
  for (const file of files) {
    const before = await readFile(file, "utf8");
    const after = rewriteTsSpecifiers(before);
    if (after !== before) {
      await writeFile(file, after, "utf8");
      changed++;
    }
  }
  return changed;
}

/**
 * bun build preserves the source shebang (`#!/usr/bin/env bun`) even with --target=node.
 * End users (especially Windows via npm/npx cmd shims) must launch with Node, not Bun.
 */
export function normalizeNodeCliBundle(source: string): string {
  let out = source.replace(/\r\n/g, "\n");

  // Drop any leading shebang lines and Bun bundle markers
  out = out.replace(/^(?:#!.*\n|\/\/\s*@bun\s*\n)+/, "");

  // Ensure a single Node shebang for Unix npm bin links / Git Bash
  if (!out.startsWith("#!/usr/bin/env node\n")) {
    out = `#!/usr/bin/env node\n${out}`;
  }

  return out;
}

async function normalizePublishedCli(): Promise<void> {
  const cliPath = join(dist, "getdotfiles.js");
  const before = await readFile(cliPath, "utf8");
  const after = normalizeNodeCliBundle(before);
  if (after !== before) {
    await writeFile(cliPath, after, "utf8");
    console.error("> normalized CLI shebang to node");
  } else {
    console.error("> CLI shebang already node");
  }
  chmodSync(cliPath, 0o755);
}

async function assertNodeShebang(): Promise<void> {
  const cliPath = join(dist, "getdotfiles.js");
  const head = (await readFile(cliPath, "utf8")).slice(0, 80);
  if (!head.startsWith("#!/usr/bin/env node\n")) {
    throw new Error(
      `dist/getdotfiles.js must start with #!/usr/bin/env node for Windows/npx; got: ${JSON.stringify(head.split("\n")[0])}`,
    );
  }
  if (head.includes("#!/usr/bin/env bun") || head.includes("// @bun")) {
    throw new Error("dist/getdotfiles.js still references bun in the header");
  }
}

async function main(): Promise<void> {
  await run(
    [
      "bun",
      "build",
      "./bin/getdotfiles.ts",
      "--target=node",
      "--outfile=./dist/getdotfiles.js",
    ],
    "bundle CLI",
  );

  await normalizePublishedCli();
  await assertNodeShebang();

  await run(
    [
      "bun",
      "build",
      "./src/index.ts",
      "--target=node",
      "--outfile=./dist/index.js",
      "--packages=external",
    ],
    "bundle library entry",
  );

  await run(["bunx", "tsc", "-p", "tsconfig.build.json"], "emit declarations");

  const fixed = await fixDeclarationImports();
  console.error(`> rewrote import specifiers in ${fixed} declaration file(s)`);

  console.error("build ok");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
