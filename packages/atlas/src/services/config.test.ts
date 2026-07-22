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

function getErrorMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected operation to throw");
}

function configWithProfileName(name: string): unknown {
  const profiles = Object.create(null) as Record<string, unknown>;
  profiles[name] = { vars: { SAFE: "yes" } };
  return { profiles };
}

function envWithOwnSource(source: string, value: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  Object.defineProperty(env, source, { configurable: true, enumerable: true, value, writable: true });
  return env;
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

  const malformedConfigCases: ReadonlyArray<readonly [string, unknown, string]> = [
    ["top-level array", [], "config must be an object"],
    ["non-string schema", { $schema: 42 }, "$schema must be a string"],
    ["defaults array", { defaults: [], profiles: {} }, "defaults must be an object"],
    [
      "non-string default profile",
      { defaults: { profiles: ["valid", 42] }, profiles: {} },
      "defaults.profiles[1] must be a string",
    ],
    ["null profiles", { profiles: null }, "profiles must be an object"],
    ["profiles array", { profiles: [] }, "profiles must be an object"],
    ["profile array", { profiles: { web: [] } }, 'profiles["web"] must be an object'],
    [
      "non-string description",
      { profiles: { web: { description: false } } },
      'profiles["web"].description must be a string',
    ],
    [
      "env files object",
      { profiles: { web: { envFiles: { file: ".env" } } } },
      'profiles["web"].envFiles must be an array',
    ],
    [
      "non-string env file",
      { profiles: { web: { envFiles: [".env", 42] } } },
      'profiles["web"].envFiles[1] must be a string',
    ],
    [
      "non-string parent profile",
      { profiles: { web: { extends: [false] } } },
      'profiles["web"].extends[0] must be a string',
    ],
    ["vars array", { profiles: { web: { vars: [] } } }, 'profiles["web"].vars must be an object'],
    [
      "non-string var",
      { profiles: { web: { vars: { PORT: 3000 } } } },
      'profiles["web"].vars["PORT"] must be a string',
    ],
    ["secrets array", { profiles: { web: { secrets: [] } } }, 'profiles["web"].secrets must be an object'],
    [
      "secret ref array",
      { profiles: { web: { secrets: { TOKEN: [] } } } },
      'profiles["web"].secrets["TOKEN"] must be an object',
    ],
    [
      "non-string secret source",
      { profiles: { web: { secrets: { TOKEN: { env: { sensitive: "do-not-echo" } } } } } },
      'profiles["web"].secrets["TOKEN"].env must be a string',
    ],
    [
      "non-boolean secret option",
      { profiles: { web: { secrets: { TOKEN: { optional: "false" } } } } },
      'profiles["web"].secrets["TOKEN"].optional must be a boolean',
    ],
  ];

  test.each(malformedConfigCases)("rejects %s with a value-free field path", (_name, config, expectedReason) => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");
    const configPath = join(project, ".atlas", "config.json");
    writeJson(configPath, config);

    const message = getErrorMessage(() => loadAtlasConfig({ cwd: project, home }));

    expect(message).toBe(`Invalid Atlas config at ${configPath}: ${expectedReason}`);
    expect(message).not.toContain("banditype");
    expect(message).not.toContain("do-not-echo");
  });

  test("defaults profiles only when the profiles section is absent", () => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), { defaults: { exportFile: ".env.generated" } });

    const loaded = loadAtlasConfig({ cwd: project, home });

    expect(Object.keys(loaded.config.profiles)).toEqual([]);
    expect(loaded.config.defaults?.exportFile).toBe(".env.generated");
  });

  test("rejects an invalid profile without discarding valid sibling profiles", () => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");
    const configPath = join(project, ".atlas", "config.json");
    writeJson(configPath, { profiles: { broken: { vars: { PORT: 3000 } }, valid: { vars: { APP: "web" } } } });

    expect(getErrorMessage(() => loadAtlasConfig({ cwd: project, home }))).toBe(
      `Invalid Atlas config at ${configPath}: profiles["broken"].vars["PORT"] must be a string`,
    );
  });

  const invalidEnvKeyCases: ReadonlyArray<readonly [string, unknown, string, string]> = [
    [
      "vars",
      { profiles: { web: { vars: { "BAD-KEY": "private-var-value" } } } },
      'profiles["web"].vars["BAD-KEY"]',
      "private-var-value",
    ],
    [
      "secrets",
      { profiles: { web: { secrets: { "1TOKEN": { env: "PRIVATE_SECRET_SOURCE" } } } } },
      'profiles["web"].secrets["1TOKEN"]',
      "PRIVATE_SECRET_SOURCE",
    ],
    [
      "secret sources",
      { profiles: { web: { secrets: { TOKEN: { env: "PRIVATE-SECRET-SOURCE" } } } } },
      'profiles["web"].secrets["TOKEN"].env',
      "PRIVATE-SECRET-SOURCE",
    ],
  ];

  test.each(invalidEnvKeyCases)(
    "rejects invalid environment variable keys in %s",
    (_section, config, fieldPath, rejectedValue) => {
      const home = join(tmpRoot, "home");
      const project = join(tmpRoot, "repo");
      const configPath = join(project, ".atlas", "config.json");
      writeJson(configPath, config);

      const message = getErrorMessage(() => loadAtlasConfig({ cwd: project, home }));

      expect(message).toBe(
        `Invalid Atlas config at ${configPath}: ${fieldPath} must be a valid environment variable name matching [A-Za-z_][A-Za-z0-9_]*`,
      );
      expect(message).not.toContain(rejectedValue);
    },
  );

  test.each(["constructor", "toString", "__proto__"])(
    "rejects configured prototype-sensitive profile name %s",
    (profileName) => {
      const home = join(tmpRoot, "home");
      const project = join(tmpRoot, "repo");
      const configPath = join(project, ".atlas", "config.json");
      writeJson(configPath, configWithProfileName(profileName));

      expect(getErrorMessage(() => loadAtlasConfig({ cwd: project, home }))).toBe(
        `Invalid Atlas config at ${configPath}: profiles[${JSON.stringify(profileName)}] must not use a prototype-sensitive profile name`,
      );
    },
  );
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

  test("preserves defined empty and whitespace-only env secret values", () => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      profiles: { secret: { secrets: { EMPTY: { env: "EMPTY_SOURCE" }, WHITESPACE: { env: "WHITESPACE_SOURCE" } } } },
    });

    const loaded = loadAtlasConfig({ cwd: project, home });
    const resolved = resolveAtlasEnv(loaded, {
      env: { EMPTY_SOURCE: "", WHITESPACE_SOURCE: "   " },
      profiles: ["secret"],
    });

    expect(resolved.env.EMPTY).toBe("");
    expect(resolved.env.WHITESPACE).toBe("   ");
  });

  test.each(["constructor", "toString", "__proto__"])("treats inherited env secret source %s as absent", (source) => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      profiles: { secret: { secrets: { TOKEN: { env: source, optional: true } } } },
    });

    const loaded = loadAtlasConfig({ cwd: project, home });
    const resolved = resolveAtlasEnv(loaded, { env: {}, profiles: ["secret"] });

    expect(Object.hasOwn(resolved.env, "TOKEN")).toBeFalse();
  });

  test.each(["constructor", "toString", "__proto__"])("resolves own empty env secret source %s", (source) => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      profiles: { secret: { secrets: { TOKEN: { env: source } } } },
    });

    const loaded = loadAtlasConfig({ cwd: project, home });
    const resolved = resolveAtlasEnv(loaded, { env: envWithOwnSource(source, ""), profiles: ["secret"] });

    expect(resolved.env.TOKEN).toBe("");
  });

  test.each(["constructor", "toString", "__proto__"])(
    "does not resolve absent inherited profile name %s for run/export selections or defaults",
    (profileName) => {
      const home = join(tmpRoot, "home");
      const project = join(tmpRoot, "repo");
      writeJson(join(project, ".atlas", "config.json"), { profiles: {} });

      const loaded = loadAtlasConfig({ cwd: project, home });
      const loadedWithDefault = {
        ...loaded,
        config: { ...loaded.config, defaults: { ...loaded.config.defaults, profiles: [profileName] } },
      };

      expect(() => resolveAtlasEnv(loaded, { profiles: [profileName] })).toThrow(
        `Unknown Atlas profile: ${profileName}`,
      );
      expect(() => resolveAtlasEnv(loadedWithDefault)).toThrow(`Unknown Atlas profile: ${profileName}`);
    },
  );

  test("applies inherited profiles once and does not reapply duplicate requested roots", () => {
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "repo");
    writeJson(join(project, ".atlas", "config.json"), {
      profiles: { base: { vars: { BASE: "yes" } }, web: { extends: ["base"], vars: { APP: "web" } } },
    });

    const loaded = loadAtlasConfig({ cwd: project, home });
    const resolved = resolveAtlasEnv(loaded, { profiles: ["web", "base", "web"] });

    expect(resolved.profiles).toEqual(["base", "web"]);
    expect(resolved.env.BASE).toBe("yes");
    expect(resolved.env.APP).toBe("web");
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
