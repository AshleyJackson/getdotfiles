#!/usr/bin/env bun
/**
 * Build:
 * 1. Bundle CLI + library entry for Node
 * 2. Emit .d.ts (+ .d.ts.map) via tsc
 * 3. Rewrite `.ts` import specifiers in declarations to `.js` for consumers
 */
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

async function main(): Promise<void> {
  // Clean previous type artifacts that may confuse incremental mental model
  // (bun build overwrites JS; tsc overwrites d.ts)

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

  await run(
    ["bunx", "tsc", "-p", "tsconfig.build.json"],
    "emit declarations",
  );

  const fixed = await fixDeclarationImports();
  console.error(`> rewrote import specifiers in ${fixed} declaration file(s)`);

  // Ensure CLI stays executable for pack/publish
  const cli = join(dist, "getdotfiles.js");
  const { chmodSync } = await import("node:fs");
  chmodSync(cli, 0o755);

  console.error("build ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
