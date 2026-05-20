import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAtlasConfig, loadAtlasConfig, resolveAtlasEnv } from "./config";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "atlas-config-"));
});

afterEach(() => {
  rmSync(tmpRoot, { force: true, recursive: true });
});

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeText(path: string, body: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
}

describe("discoverAtlasConfig", () => {
  test("finds global config and nearest project config from nested cwd", () => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");
    const nested = join(project, "apps", "web");

    writeJson(join(home, ".atlas", "config.json"), { profiles: { team: { vars: { TEAM: "r5n" } } } });
    writeJson(join(project, ".atlas", "config.json"), { profiles: { "app:web": { vars: { APP: "web" } } } });
    mkdirSync(nested, { recursive: true });

    const discovered = discoverAtlasConfig({ cwd: nested, home });

    expect(discovered.globalPath).toBe(join(home, ".atlas", "config.json"));
    expect(discovered.projectPath).toBe(join(project, ".atlas", "config.json"));
    expect(discovered.projectRoot).toBe(project);
  });

  test("uses the closest project config when directories are nested", () => {
    const home = join(tmpRoot, "home");
    const outer = join(tmpRoot, "outer");
    const inner = join(outer, "inner");

    writeJson(join(outer, ".atlas", "config.json"), { profiles: { outer: { vars: { NAME: "outer" } } } });
    writeJson(join(inner, ".atlas", "config.json"), { profiles: { inner: { vars: { NAME: "inner" } } } });

    const discovered = discoverAtlasConfig({ cwd: join(inner, "src"), home });

    expect(discovered.projectPath).toBe(join(inner, ".atlas", "config.json"));
    expect(discovered.projectRoot).toBe(inner);
  });

  test("does not use the global config as a discovered project config", () => {
    const home = join(tmpRoot, "home");
    const project = join(home, "projects", "app");

    writeJson(join(home, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.global", profiles: ["team"] },
      profiles: { team: { vars: { TEAM: "r5n" } } },
    });
    mkdirSync(project, { recursive: true });

    const discovered = discoverAtlasConfig({ cwd: project, home });
    const loaded = loadAtlasConfig({ cwd: project, home });
    const resolved = resolveAtlasEnv(loaded);

    expect(discovered.globalPath).toBe(join(home, ".atlas", "config.json"));
    expect(discovered.projectPath).toBeUndefined();
    expect(discovered.projectRoot).toBeUndefined();
    expect(loaded.config.defaults?.profiles).toEqual(["team"]);
    expect(resolved.exportFile).toBe(join(project, ".env.global"));
  });
});

describe("loadAtlasConfig", () => {
  test("merges global defaults with project defaults and lets project profiles override globals", () => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");

    writeJson(join(home, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.global", profiles: ["team"] },
      profiles: { "app:web": { vars: { APP: "global" } }, team: { vars: { TEAM: "r5n" } } },
    });
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.local", profiles: ["app:web"] },
      profiles: { "app:web": { vars: { APP: "web" } } },
    });

    const loaded = loadAtlasConfig({ cwd: project, home });

    expect(loaded.config.defaults?.profiles).toEqual(["team", "app:web"]);
    expect(loaded.config.defaults?.exportFile).toBe(".env.local");
    expect(loaded.config.profiles["app:web"]?.vars?.APP).toBe("web");
    expect(loaded.config.profiles.team?.vars?.TEAM).toBe("r5n");
  });

  test("throws a readable error for invalid JSON", () => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");
    writeText(join(project, ".atlas", "config.json"), "{not json");

    expect(() => loadAtlasConfig({ cwd: project, home })).toThrow("Invalid JSON");
  });
});

describe("resolveAtlasEnv", () => {
  test("resolves defaults, selected profiles, extends, env files, vars, and file secrets in precedence order", () => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");

    writeJson(join(home, ".atlas", "config.json"), {
      defaults: { profiles: ["team"] },
      profiles: { team: { vars: { SHARED: "global", TEAM: "r5n" } } },
    });
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.out", profiles: ["app:web"] },
      profiles: {
        "app:web": {
          envFiles: [".env.shared", ".env.local"],
          extends: ["base"],
          vars: { APP: "web", SHARED: "project" },
        },
        base: { vars: { BASE: "yes", SHARED: "base" } },
        "env:dev": { vars: { MODE: "dev", SHARED: "dev" } },
        "secret:file": { secrets: { FILE_SECRET: { file: ".secrets/token" } } },
      },
    });
    writeText(join(project, ".env.shared"), "FROM_FILE=one\nSHARED=env-file\n");
    writeText(join(project, ".env.local"), "FROM_FILE=two\nLOCAL_ONLY=1\n");
    writeText(join(project, ".secrets", "token"), "  abc123\n");

    const loaded = loadAtlasConfig({ cwd: project, home });
    const resolved = resolveAtlasEnv(loaded, { profiles: ["env:dev", "secret:file"] });

    expect(resolved.profiles).toEqual(["team", "base", "app:web", "env:dev", "secret:file"]);
    expect(resolved.env).toEqual({
      APP: "web",
      BASE: "yes",
      FILE_SECRET: "abc123",
      FROM_FILE: "two",
      LOCAL_ONLY: "1",
      MODE: "dev",
      SHARED: "dev",
      TEAM: "r5n",
    });
    expect(resolved.exportFile).toBe(join(project, ".env.out"));
  });

  test("resolves env and file secrets, preserving whitespace when trim is false", () => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");

    writeJson(join(project, ".atlas", "config.json"), {
      profiles: {
        secret: {
          secrets: { API_KEY: { env: "ATLAS_TEST_API_KEY" }, RAW_CERT: { file: ".secrets/cert", trim: false } },
        },
      },
    });
    writeText(join(project, ".secrets", "cert"), " certificate body \n");

    const loaded = loadAtlasConfig({ cwd: project, home });
    const resolved = resolveAtlasEnv(loaded, { env: { ATLAS_TEST_API_KEY: "from-env" }, profiles: ["secret"] });

    expect(resolved.env.API_KEY).toBe("from-env");
    expect(resolved.env.RAW_CERT).toBe(" certificate body \n");
  });

  test("throws on missing required profiles, missing required secrets, and profile cycles", () => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");

    writeJson(join(project, ".atlas", "config.json"), {
      profiles: {
        cycleA: { extends: ["cycleB"] },
        cycleB: { extends: ["cycleA"] },
        needsSecret: { secrets: { TOKEN: { env: "MISSING_TOKEN" } } },
      },
    });

    const loaded = loadAtlasConfig({ cwd: project, home });

    expect(() => resolveAtlasEnv(loaded, { profiles: ["missing"] })).toThrow("Unknown Atlas profile: missing");
    expect(() => resolveAtlasEnv(loaded, { profiles: ["needsSecret"], env: {} })).toThrow(
      "Missing required secret TOKEN",
    );
    expect(() => resolveAtlasEnv(loaded, { profiles: ["cycleA"] })).toThrow("Profile inheritance cycle");
  });
});
