import { describe, expect, test } from "bun:test";
import { normalizeNodeCliBundle } from "../scripts/build.ts";

describe("normalizeNodeCliBundle", () => {
  test("replaces bun shebang with node", () => {
    const input = `#!/usr/bin/env bun
// @bun
import { createRequire } from "node:module";
console.log("hi");
`;
    const out = normalizeNodeCliBundle(input);
    expect(out.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(out).not.toContain("#!/usr/bin/env bun");
    expect(out).not.toContain("// @bun");
    expect(out).toContain('import { createRequire } from "node:module";');
  });

  test("is idempotent when already node", () => {
    const input = `#!/usr/bin/env node
console.log(1);
`;
    const once = normalizeNodeCliBundle(input);
    const twice = normalizeNodeCliBundle(once);
    expect(twice).toBe(once);
    expect([...twice.matchAll(/#!\/usr\/bin\/env node/g)]).toHaveLength(1);
  });

  test("adds node shebang when missing", () => {
    const out = normalizeNodeCliBundle(`export const x = 1;\n`);
    expect(out).toBe(`#!/usr/bin/env node\nexport const x = 1;\n`);
  });

  test("normalizes CRLF from Windows checkouts", () => {
    const out = normalizeNodeCliBundle("#!/usr/bin/env bun\r\n// @bun\r\nconst x = 1;\r\n");
    expect(out.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(out).not.toContain("\r");
  });
});
