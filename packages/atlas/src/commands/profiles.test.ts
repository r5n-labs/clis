import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigManager } from "@r5n/cli-core";
import type { AtlasConfig } from "../types";
import { ProfilesListCommand, ProfilesShowCommand } from "./profiles";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "atlas-profiles-"));
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

type ListCtx = Parameters<ProfilesListCommand["execute"]>[0];
type ShowCtx = Parameters<ProfilesShowCommand["execute"]>[0];

function listCtx(args: { cwd: string; json?: boolean }): ListCtx {
  return {
    args: { cwd: args.cwd, json: args.json ?? false },
    cli: {} as never,
    config: new FakeConfigManager() as unknown as ConfigManager<AtlasConfig>,
    interactive: false,
    positionals: {},
  } as unknown as ListCtx;
}

function showCtx(args: { cwd: string; json?: boolean; profile: string }): ShowCtx {
  return {
    args: { cwd: args.cwd, json: args.json ?? false },
    cli: {} as never,
    config: new FakeConfigManager() as unknown as ConfigManager<AtlasConfig>,
    interactive: false,
    positionals: { profile: args.profile },
  } as unknown as ShowCtx;
}

describe("ProfilesCommand JSON output", () => {
  test("profiles list writes raw JSON to stdout", async () => {
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      profiles: { "env:dev": { vars: { MODE: "dev" } }, "app:web": { vars: { APP: "web" } } },
    });

    const output = await captureStdout(() => new ProfilesListCommand().execute(listCtx({ cwd: project, json: true })));

    expect(JSON.parse(output)).toEqual(["app:web", "env:dev"]);
  });

  test("profiles show writes raw JSON to stdout", async () => {
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      profiles: { "app:web": { description: "Web app", vars: { APP: "web" } } },
    });

    const output = await captureStdout(() =>
      new ProfilesShowCommand().execute(showCtx({ cwd: project, json: true, profile: "app:web" })),
    );

    expect(JSON.parse(output)).toEqual({ description: "Web app", vars: { APP: "web" } });
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
