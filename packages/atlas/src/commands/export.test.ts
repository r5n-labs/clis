import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigManager, Exit } from "@r5n/cli-core";
import type { AtlasConfig } from "../types";
import { ExportCommand } from "./export";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "atlas-export-"));
});

afterEach(() => {
  rmSync(tmpRoot, { force: true, recursive: true });
});

class FakeConfigManager {
  exists(): boolean {
    return false;
  }
  get<K extends keyof AtlasConfig>(_key: K): AtlasConfig[K] {
    throw new Error("unused");
  }
  getAll(): AtlasConfig {
    throw new Error("unused");
  }
  set<K extends keyof AtlasConfig>(_key: K, _value: AtlasConfig[K]): void {}
  save(_config?: AtlasConfig): void {}
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

type ExportCtx = Parameters<ExportCommand["execute"]>[0];

function ctx(args: { cwd: string; force?: boolean; out?: string; profile?: string; stdout?: boolean }): ExportCtx {
  return {
    args: {
      cwd: args.cwd,
      force: args.force ?? false,
      out: args.out,
      profile: args.profile,
      stdout: args.stdout ?? false,
    },
    cli: {} as never,
    config: new FakeConfigManager() as unknown as ConfigManager<AtlasConfig>,
    interactive: false,
    positionals: {},
  } as unknown as ExportCtx;
}

describe("ExportCommand", () => {
  test("writes resolved env to the configured output file", async () => {
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.generated", profiles: ["app:web"] },
      profiles: { "app:web": { vars: { APP: "web", MODE: "test" } } },
    });

    await new ExportCommand().execute(ctx({ cwd: project }));

    expect(readFileSync(join(project, ".env.generated"), "utf8")).toBe("APP=web\nMODE=test\n");
  });

  test("refuses to overwrite an existing output file without force", async () => {
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.generated", profiles: ["app:web"] },
      profiles: { "app:web": { vars: { APP: "web" } } },
    });
    writeFileSync(join(project, ".env.generated"), "EXISTING=1\n", "utf8");

    await expect(new ExportCommand().execute(ctx({ cwd: project }))).rejects.toThrow(Exit);
    expect(readFileSync(join(project, ".env.generated"), "utf8")).toBe("EXISTING=1\n");
  });

  test("uses explicit profiles and output path when provided", async () => {
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      profiles: { "app:web": { vars: { APP: "web" } }, "env:prod": { vars: { MODE: "production" } } },
    });

    await new ExportCommand().execute(ctx({ cwd: project, out: ".env.prod", profile: "app:web,env:prod" }));

    expect(readFileSync(join(project, ".env.prod"), "utf8")).toBe("APP=web\nMODE=production\n");
  });

  test("writes raw dotenv content to stdout", async () => {
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { profiles: ["app:web"] },
      profiles: { "app:web": { vars: { APP: "web" } } },
    });

    const output = await captureStdout(() => new ExportCommand().execute(ctx({ cwd: project, stdout: true })));

    expect(output).toBe("APP=web\n");
  });
});

async function captureStdout(run: () => Promise<void>): Promise<string> {
  let output = "";
  const originalWrite = process.stdout.write;

  process.stdout.write = ((chunk, encodingOrCallback, callback) => {
    const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8";
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(encoding);
    const cb = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    cb?.();
    return true;
  }) as typeof process.stdout.write;

  try {
    await run();
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
}
