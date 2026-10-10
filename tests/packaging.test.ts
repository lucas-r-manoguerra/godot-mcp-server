// Packaging gate, full (AC-01): --help exits 0; stdio and http
// entrypoints construct via the same buildServer factory symbol;
// the packed artifact ships a runnable bin entrypoint.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { buildServer } from "../src/server/buildServer.js";
import * as httpEntry from "../src/transports/http.js";
import * as stdioEntry from "../src/transports/stdio.js";

class ExitSignal extends Error {
  code: number;
  constructor(code: number) {
    super(`exit:${code}`);
    this.code = code;
  }
}

describe("packaging", () => {
  it("--help exits 0", async () => {
    let out = "";
    let code = -1;
    try {
      await main(["--help"], {
        stdout: (text: string) => {
          out += text;
        },
        exit: (c: number): never => {
          code = c;
          throw new ExitSignal(c);
        },
      });
    } catch (error) {
      if (!(error instanceof ExitSignal)) throw error;
    }
    expect(code).toBe(0);
    expect(out).toContain("--http");
  });

  it("stdio and http entrypoints share the buildServer factory", async () => {
    expect(typeof stdioEntry.serveStdio).toBe("function");
    expect(typeof httpEntry.serveHttp).toBe("function");
    const root = path.resolve(import.meta.dirname, "..", "src", "transports");
    const [stdioSrc, httpSrc] = await Promise.all([
      readFile(path.join(root, "stdio.ts"), "utf8"),
      readFile(path.join(root, "http.ts"), "utf8"),
    ]);
    expect(stdioSrc).toContain('from "../server/buildServer.js"');
    expect(httpSrc).toContain('from "../server/buildServer.js"');
    const built = buildServer();
    expect(built.ctx.capabilities.server_version).toContain("godot-mcp-server/");
  });

  it("packed artifact ships a runnable bin entrypoint (clean-install half)", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      bin?: Record<string, string>;
      files?: string[];
    };
    const binTarget = pkg.bin?.["godot-mcp-server"];
    expect(binTarget).toBe("./dist/cli.js");
    expect(pkg.files ?? []).toContain("dist/**");
    // The bin file must exec under node when launched through an npm
    // .bin symlink (kernel uses the shebang, not the package.json).
    const firstLine = (await readFile(path.join(root, "src", "cli.ts"), "utf8")).split("\n")[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });
});
