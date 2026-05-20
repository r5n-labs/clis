import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigManager } from "@r5n/cli-core";
import type { AtlasConfig } from "../types";
import { buildRunEnvironment, RunCommand } from "./run";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "atlas-run-"));
});

afterEach(() => {
  rmSync(tmpRoot, { force: true, recursive: true });
});

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

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

type RunCtx = Parameters<RunCommand["execute"]>[0];

function ctx(args: { command: string[]; cwd: string; profile?: string }): RunCtx {
  return {
    args: { cwd: args.cwd, profile: args.profile },
    cli: {} as never,
    config: new FakeConfigManager() as unknown as ConfigManager<AtlasConfig>,
    interactive: false,
    positionals: { command: args.command },
  } as unknown as RunCtx;
}

describe("buildRunEnvironment", () => {
  test("combines process env with resolved Atlas env and lets Atlas values win", () => {
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      profiles: { "app:web": { vars: { APP: "web", EXISTING: "atlas" } } },
    });

    const env = buildRunEnvironment({ cwd: project, env: { EXISTING: "process", KEEP: "yes" }, profiles: ["app:web"] });

    expect(env).toEqual({ APP: "web", EXISTING: "atlas", KEEP: "yes" });
  });
});

describe("RunCommand", () => {
  test("spawns the command in the requested cwd", async () => {
    const project = join(tmpRoot, "repo");
    const output = join(tmpRoot, "pwd.txt");
    mkdirSync(project, { recursive: true });
    writeJson(join(project, ".atlas", "config.json"), { profiles: {} });

    await new RunCommand().execute(ctx({ command: ["sh", "-c", `pwd > ${output}`], cwd: project }));

    expect(realpathSync(readFileSync(output, "utf8").trim())).toBe(realpathSync(project));
  });
});
