import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Exit } from "@r5n/cli-core";
import { loadAtlasConfig, resolveAtlasEnv } from "./config";

let fixtureRoot: string;
let project: string;
let configPath: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "atlas-config-validation-"));
  project = join(fixtureRoot, "project");
  configPath = join(project, ".atlas", "config.json");
  mkdirSync(join(project, ".atlas"), { recursive: true });
});

afterEach(() => {
  rmSync(fixtureRoot, { force: true, recursive: true });
});

function load(config: unknown) {
  writeFileSync(configPath, JSON.stringify(config));
  return loadAtlasConfig({ cwd: project, home: join(fixtureRoot, "home") });
}

describe("Atlas config references", () => {
  test.each([
    [{}, "must define env or file"],
    [{ optional: true }, "must define env or file"],
    [{ env: "SOURCE", file: "source.txt" }, "must define only one of env or file"],
    [{ file: "" }, "file must be a non-empty string"],
    [{ env: "SOURCE", trim: true }, "trim only applies to file secrets"],
  ] as const)("rejects ambiguous or incomplete secret references %j", (ref, message) => {
    expect(() => load({ profiles: { app: { secrets: { TOKEN: ref } } } })).toThrow(message);
  });

  test.each([
    [{ defaults: { exportFile: "" } }, "defaults.exportFile"],
    [{ defaults: { profiles: [""] } }, "defaults.profiles[0]"],
    [{ profiles: { app: { envFiles: [""] } } }, 'profiles["app"].envFiles[0]'],
    [{ profiles: { app: { extends: [""] } } }, 'profiles["app"].extends[0]'],
  ] as const)("rejects empty path and profile references %j", (config, field) => {
    expect(() => load(config)).toThrow(`${field} must be a non-empty string`);
  });

  test.each(["env", "secret"])("identifies a directory supplied as an %s file", (kind) => {
    const directory = join(project, "directory");
    mkdirSync(directory);
    const profile = kind === "env" ? { envFiles: ["directory"] } : { secrets: { TOKEN: { file: "directory" } } };
    const loaded = load({ defaults: { profiles: ["app"] }, profiles: { app: profile } });
    const error = captureError(() => resolveAtlasEnv(loaded));
    expect(error).toBeInstanceOf(Exit);
    expect(error.message).toContain("Failed to read");
    expect(error.message).toContain(directory);
    expect(error.cause).toBeInstanceOf(Error);
    expect((error as Exit).hint).toContain("readable file");
  });

  test("retains the underlying error when the config path is a directory", () => {
    mkdirSync(configPath);
    const error = captureError(() => loadAtlasConfig({ cwd: project, home: join(fixtureRoot, "home") }));
    expect(error).toBeInstanceOf(Exit);
    expect(error.message).toContain(`Failed to read Atlas config ${configPath}`);
    expect(error.cause).toBeInstanceOf(Error);
  });
});

function captureError(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected operation to throw");
}
