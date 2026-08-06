import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessExitError } from "../src/main.ts";
import type { Dotfile } from "../src/schemas.ts";

export function makeDotfile(overrides: Partial<Dotfile> = {}): Dotfile {
  return {
    path: overrides.path ?? ".bashrc",
    name: overrides.name ?? ".bashrc",
    download_url:
      overrides.download_url ?? "https://raw.githubusercontent.com/user/dotfiles/main/.bashrc",
  };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export function textResponse(body: string | Uint8Array, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: init.headers,
  });
}

export function githubFile(
  name: string,
  path: string,
  download_url: string | null = `https://raw.githubusercontent.com/u/r/main/${path}`,
) {
  return {
    type: "file" as const,
    name,
    path,
    download_url,
  };
}

export function githubDir(name: string, path: string) {
  return {
    type: "dir" as const,
    name,
    path,
    download_url: null,
  };
}

/** Create a unique temp directory and return a disposer. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "getdotfiles-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export { ProcessExitError as ExitError };

export function captureIo() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    },
    error: (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    },
    exit: (code: number): never => {
      throw new ProcessExitError(code);
    },
  };
}
