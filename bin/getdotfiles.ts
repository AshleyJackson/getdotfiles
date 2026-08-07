#!/usr/bin/env node
/**
 * Dev entry. The published CLI is the Node-targeted bundle in dist/getdotfiles.js.
 * When running via `bun run dev`, Bun still executes this file even with a node shebang.
 */
import { main } from "../src/main.ts";

await main(process.argv.slice(2));
