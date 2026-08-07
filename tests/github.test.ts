import { describe, expect, test } from "bun:test";
import {
  collectDotfiles,
  fetchContents,
  getRawUrl,
  getToken,
  ghInteractiveInvocations,
  ghTokenInvocations,
  isDotfile,
  isUnderDotPath,
  listDotfilesRepo,
} from "../src/github.ts";
import { githubDir, githubFile, jsonResponse } from "./helpers.ts";

describe("isDotfile", () => {
  test("true only when name starts with dot", () => {
    expect(isDotfile(".bashrc")).toBe(true);
    expect(isDotfile(".gitconfig")).toBe(true);
    expect(isDotfile("README.md")).toBe(false);
    expect(isDotfile("bashrc")).toBe(false);
    expect(isDotfile("")).toBe(false);
  });
});

describe("isUnderDotPath", () => {
  test("true when any segment is a dot-segment", () => {
    expect(isUnderDotPath(".config")).toBe(true);
    expect(isUnderDotPath(".config/nvim/init.lua")).toBe(true);
    expect(isUnderDotPath("src/.hidden")).toBe(true);
    expect(isUnderDotPath("src/app.ts")).toBe(false);
    expect(isUnderDotPath("")).toBe(false);
  });
});

describe("getRawUrl", () => {
  test("builds raw.githubusercontent.com URL on main", () => {
    expect(getRawUrl("a", "dotfiles", ".bashrc")).toBe(
      "https://raw.githubusercontent.com/a/dotfiles/main/.bashrc",
    );
  });
});

describe("ghTokenInvocations", () => {
  test("unix uses plain gh", () => {
    const list = ghTokenInvocations("linux");
    expect(list).toHaveLength(1);
    expect(list[0]?.command).toBe("gh");
    expect(list[0]?.options.shell).toBeUndefined();
  });

  test("windows prefers gh.exe; .cmd only with shell (avoid spawn EINVAL)", () => {
    const list = ghTokenInvocations("win32");
    expect(list.map((x) => x.command)).toEqual(["gh.exe", "gh", "gh.cmd", "gh"]);
    // Bare .cmd without shell is banned by Node CVE-2024-27980
    const cmdShim = list.find((x) => x.command === "gh.cmd");
    expect(cmdShim?.options.shell).toBe(true);
    expect(list.at(-1)?.options.shell).toBe(true);
    expect(list.every((x) => x.options.windowsHide === true)).toBe(true);
  });
});

describe("ghInteractiveInvocations", () => {
  test("unix uses plain gh auth login", () => {
    const list = ghInteractiveInvocations("linux");
    expect(list).toHaveLength(1);
    expect(list[0]?.command).toBe("gh");
    expect(list[0]?.args).toEqual(["auth", "login"]);
  });

  test("windows never spawns bare .cmd without shell", () => {
    const list = ghInteractiveInvocations("win32", ["auth", "login"]);
    expect(list[0]?.command).toBe("gh.exe");
    expect(list.some((x) => x.command === "cmd.exe")).toBe(true);
    for (const inv of list) {
      if (/\.cmd$/i.test(inv.command)) {
        expect(inv.options.shell).toBe(true);
      }
      expect(inv.options.windowsHide).toBe(false);
      expect(inv.args).toContain("auth");
    }
  });
});

describe("getToken", () => {
  test("prefers GITHUB_TOKEN env", async () => {
    const token = await getToken({
      env: { GITHUB_TOKEN: "  ghp_from_env  " },
      execFile: async () => {
        throw new Error("should not call gh");
      },
    });
    expect(token).toBe("ghp_from_env");
  });

  test("falls back to gh CLI stdout", async () => {
    const token = await getToken({
      env: {},
      platform: "linux",
      execFile: async () => ({ stdout: "ghp_from_cli\n", stderr: "" }),
    });
    expect(token).toBe("ghp_from_cli");
  });

  test("returns null when env empty and gh fails", async () => {
    const token = await getToken({
      env: { GITHUB_TOKEN: "   " },
      platform: "linux",
      execFile: async () => {
        throw new Error("gh missing");
      },
    });
    expect(token).toBeNull();
  });

  test("windows tries multiple gh candidates until one works", async () => {
    const tried: string[] = [];
    const token = await getToken({
      env: {},
      platform: "win32",
      execFile: async (cmd) => {
        tried.push(cmd);
        if (cmd !== "gh.exe") throw new Error("nope");
        return { stdout: "tok", stderr: "" };
      },
    });
    expect(token).toBe("tok");
    expect(tried[0]).toBe("gh.exe");
    expect(tried).toEqual(["gh.exe"]);
  });
});

describe("fetchContents", () => {
  test("returns validated items on success", async () => {
    const items = await fetchContents("u", "dotfiles", "", null, {
      fetch: async () =>
        jsonResponse([
          githubFile(".bashrc", ".bashrc"),
          githubDir(".config", ".config"),
        ]),
    });
    expect(items).toHaveLength(2);
    expect(items[0]?.name).toBe(".bashrc");
  });

  test("sends Authorization when token present", async () => {
    let auth = "";
    await fetchContents("u", "r", "", "secret", {
      fetch: async (_url, init) => {
        const headers = new Headers(init?.headers);
        auth = headers.get("Authorization") ?? "";
        return jsonResponse([githubFile(".a", ".a")]);
      },
    });
    expect(auth).toBe("Bearer secret");
  });

  test("404 becomes friendly error", async () => {
    await expect(
      fetchContents("missing", "dotfiles", "", null, {
        fetch: async () => jsonResponse({ message: "Not Found" }, { status: 404 }),
      }),
    ).rejects.toThrow('Repo "missing/dotfiles" not found.');
  });

  test("403 without token suggests GITHUB_TOKEN", async () => {
    await expect(
      fetchContents("u", "r", "", null, {
        fetch: async () => new Response("nope", { status: 403, statusText: "Forbidden" }),
      }),
    ).rejects.toThrow("GITHUB_TOKEN");
  });

  test("403 with token says try later", async () => {
    await expect(
      fetchContents("u", "r", "", "tok", {
        fetch: async () => new Response("nope", { status: 403, statusText: "Forbidden" }),
      }),
    ).rejects.toThrow("Try again later");
  });

  test("other errors include status", async () => {
    await expect(
      fetchContents("u", "r", "", null, {
        fetch: async () => new Response("x", { status: 500, statusText: "Boom" }),
      }),
    ).rejects.toThrow("500");
  });

  test("rejects unexpected JSON shape via Zod", async () => {
    await expect(
      fetchContents("u", "r", "", null, {
        fetch: async () => jsonResponse({ unexpected: true }),
      }),
    ).rejects.toThrow("Unexpected GitHub API response shape");
  });
});

describe("collectDotfiles", () => {
  test("includes all files at any depth (not only root dots)", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/contents/") || url.endsWith("/contents")) {
        return jsonResponse([
          githubFile(".bashrc", ".bashrc"),
          githubFile("README.md", "README.md"),
          githubFile("LICENSE", "LICENSE"),
          githubDir(".config", ".config"),
          githubDir("Documents", "Documents"),
        ]);
      }
      if (url.endsWith("/contents/.config")) {
        return jsonResponse([
          githubDir("nvim", ".config/nvim"),
          githubFile("starship.toml", ".config/starship.toml"),
        ]);
      }
      if (url.endsWith("/contents/.config/nvim")) {
        return jsonResponse([
          githubFile("init.lua", ".config/nvim/init.lua"),
          githubDir("lua", ".config/nvim/lua"),
        ]);
      }
      if (url.endsWith("/contents/.config/nvim/lua")) {
        return jsonResponse([githubFile("plugins.lua", ".config/nvim/lua/plugins.lua")]);
      }
      if (url.endsWith("/contents/Documents")) {
        return jsonResponse([
          githubDir("WindowsPowerShell", "Documents/WindowsPowerShell"),
        ]);
      }
      if (url.endsWith("/contents/Documents/WindowsPowerShell")) {
        return jsonResponse([
          githubFile(
            "Microsoft.PowerShell_profile.ps1",
            "Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1",
          ),
        ]);
      }
      return jsonResponse([], { status: 404, statusText: "Not Found" });
    };

    const files = await collectDotfiles("u", "dotfiles", "", null, { fetch: fetchImpl });
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      ".bashrc",
      ".config/nvim/init.lua",
      ".config/nvim/lua/plugins.lua",
      ".config/starship.toml",
      "Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1",
      "LICENSE",
      "README.md",
    ]);
  });

  test("matches AshleyJackson/dotfiles-style tree (Documents + root files)", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/contents/") || url.endsWith("/contents")) {
        return jsonResponse([
          githubFile(".bashrc", ".bashrc"),
          githubFile(".gitignore", ".gitignore"),
          githubFile(".nanorc", ".nanorc"),
          githubFile(".selected_editor", ".selected_editor"),
          githubDir("Documents", "Documents"),
        ]);
      }
      if (url.endsWith("/contents/Documents")) {
        return jsonResponse([githubDir("WindowsPowerShell", "Documents/WindowsPowerShell")]);
      }
      if (url.endsWith("/contents/Documents/WindowsPowerShell")) {
        return jsonResponse([
          githubFile(
            "Microsoft.PowerShell_profile.ps1",
            "Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1",
          ),
        ]);
      }
      return jsonResponse([], { status: 404, statusText: "Not Found" });
    };

    const files = await collectDotfiles("AshleyJackson", "dotfiles", "", null, {
      fetch: fetchImpl,
    });
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      ".bashrc",
      ".gitignore",
      ".nanorc",
      ".selected_editor",
      "Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1",
    ]);
  });

  test("skips .git and node_modules directories", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/contents/") || url.endsWith("/contents")) {
        return jsonResponse([
          githubFile("app.txt", "app.txt"),
          githubDir(".git", ".git"),
          githubDir("node_modules", "node_modules"),
        ]);
      }
      if (url.includes("/contents/.git") || url.includes("/contents/node_modules")) {
        throw new Error("should not recurse skipped dirs");
      }
      return jsonResponse([], { status: 404, statusText: "Not Found" });
    };

    const files = await collectDotfiles("u", "r", "", null, { fetch: fetchImpl });
    expect(files.map((f) => f.path)).toEqual(["app.txt"]);
  });

  test("handles single-file contents response", async () => {
    const files = await collectDotfiles("u", "r", ".bashrc", null, {
      fetch: async () => jsonResponse(githubFile(".bashrc", ".bashrc")),
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".bashrc");
  });

  test("skips files without download_url", async () => {
    const files = await collectDotfiles("u", "r", "", null, {
      fetch: async () => jsonResponse([githubFile(".lfs", ".lfs", null)]),
    });
    expect(files).toEqual([]);
  });
});

describe("listDotfilesRepo", () => {
  test("validates owner and lists via token", async () => {
    const files = await listDotfilesRepo("ashleyjackson", "dotfiles", {
      env: { GITHUB_TOKEN: "t" },
      fetch: async () => jsonResponse([githubFile(".nanorc", ".nanorc")]),
    });
    expect(files).toHaveLength(1);
  });

  test("rejects invalid owner", async () => {
    await expect(
      listDotfilesRepo("", "dotfiles", {
        fetch: async () => jsonResponse([]),
      }),
    ).rejects.toThrow("Invalid GitHub username");
  });

  test("rejects empty repo name", async () => {
    await expect(
      listDotfilesRepo("user", "", {
        fetch: async () => jsonResponse([]),
      }),
    ).rejects.toThrow("Invalid repository name");
  });
});
