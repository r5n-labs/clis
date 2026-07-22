import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigManager, Exit } from "@r5n/cli-core";
import type { AtlasConfig } from "../types";
import { ExportCommand } from "./export";

const PRIVATE_FILE_MODE = 0o600;
const PUBLIC_FILE_MODE = 0o644;
const PERMISSIONS_MASK = 0o777;
const RESTRICTIVE_UMASK = 0o777;

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

  test("allows only one concurrent no-force export to create the output file", async () => {
    const project = join(tmpRoot, "repo");
    const outputPath = join(project, ".env.generated");
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.generated", profiles: ["app:web"] },
      profiles: { "app:web": { vars: { APP: "web" } } },
    });

    const outcomes = await Promise.allSettled([
      new ExportCommand().execute(ctx({ cwd: project })),
      new ExportCommand().execute(ctx({ cwd: project })),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(Exit);
    expect(readFileSync(outputPath, "utf8")).toBe("APP=web\n");
  });

  test("creates new no-force exports with exact private permissions under a restrictive umask", async () => {
    const project = join(tmpRoot, "repo");
    const outputPath = join(project, ".env.generated");
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.generated", profiles: ["app:web"] },
      profiles: { "app:web": { vars: { APP: "web" } } },
    });
    const previousUmask = process.umask(RESTRICTIVE_UMASK);

    try {
      await new ExportCommand().execute(ctx({ cwd: project }));
    } finally {
      process.umask(previousUmask);
    }

    expect(statSync(outputPath).mode & PERMISSIONS_MASK).toBe(PRIVATE_FILE_MODE);
  });

  test("creates new force exports with exact private permissions under a restrictive umask", async () => {
    const project = join(tmpRoot, "repo");
    const outputPath = join(project, ".env.generated");
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.generated", profiles: ["app:web"] },
      profiles: { "app:web": { vars: { APP: "web" } } },
    });
    const previousUmask = process.umask(RESTRICTIVE_UMASK);

    try {
      await new ExportCommand().execute(ctx({ cwd: project, force: true }));
    } finally {
      process.umask(previousUmask);
    }

    expect(readFileSync(outputPath, "utf8")).toBe("APP=web\n");
    expect(statSync(outputPath).mode & PERMISSIONS_MASK).toBe(PRIVATE_FILE_MODE);
  });

  test("tightens permissions when force-overwriting an existing export", async () => {
    const project = join(tmpRoot, "repo");
    const outputPath = join(project, ".env.generated");
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.generated", profiles: ["app:web"] },
      profiles: { "app:web": { vars: { APP: "web" } } },
    });
    writeFileSync(outputPath, "EXISTING=1\n", "utf8");
    chmodSync(outputPath, PUBLIC_FILE_MODE);

    await new ExportCommand().execute(ctx({ cwd: project, force: true }));

    expect(readFileSync(outputPath, "utf8")).toBe("APP=web\n");
    expect(statSync(outputPath).mode & PERMISSIONS_MASK).toBe(PRIVATE_FILE_MODE);
  });

  test("preserves existing content when force chmod fails before truncation", async () => {
    const project = join(tmpRoot, "repo");
    const outputPath = join(project, ".env.generated");
    const existingContent = "EXISTING=1\n";
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.generated", profiles: ["app:web"] },
      profiles: { "app:web": { vars: { APP: "web" } } },
    });
    writeFileSync(outputPath, existingContent, "utf8");
    const probeHandle = await open(outputPath, "r+");
    const fileHandlePrototype = Object.getPrototypeOf(probeHandle) as { chmod: FileHandle["chmod"] };
    await probeHandle.close();
    const chmodSpy = spyOn(fileHandlePrototype, "chmod").mockRejectedValue(new Error("chmod failed"));

    try {
      await expect(new ExportCommand().execute(ctx({ cwd: project, force: true }))).rejects.toThrow("chmod failed");
    } finally {
      chmodSpy.mockRestore();
    }

    expect(readFileSync(outputPath, "utf8")).toBe(existingContent);
  });

  test("force replaces an output symlink without modifying its target", async () => {
    const project = join(tmpRoot, "repo");
    const outputPath = join(project, ".env.generated");
    const targetPath = join(tmpRoot, "target.env");
    writeJson(join(project, ".atlas", "config.json"), {
      defaults: { exportFile: ".env.generated", profiles: ["app:web"] },
      profiles: { "app:web": { vars: { APP: "web" } } },
    });
    writeFileSync(targetPath, "TARGET=preserved\n", "utf8");
    symlinkSync(targetPath, outputPath);

    await new ExportCommand().execute(ctx({ cwd: project, force: true }));

    expect(lstatSync(outputPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(outputPath, "utf8")).toBe("APP=web\n");
    expect(readFileSync(targetPath, "utf8")).toBe("TARGET=preserved\n");
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
