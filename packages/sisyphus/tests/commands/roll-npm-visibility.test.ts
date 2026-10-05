import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { rmSync } from "node:fs";
import type { ConfigManager } from "@r5n/cli-core";
import { RollCommand } from "../../src/commands/roll";
import { ReleaseLedger } from "../../src/services/release-ledger";
import type { SisyphusConfig } from "../../src/types";
import { type FakeNpmRegistry, type PackumentView, startFakeNpmRegistry } from "../helpers/npm-registry";
import {
  type Fixture,
  gitText,
  makeConfig,
  makePublishPackage,
  PACKAGE_NAME,
  setupReleaseFixture,
} from "../helpers/release-orchestrator";
import { makeCtx, type RollCtx } from "../helpers/roll";

const RELEASED_VERSION = "1.0.1";
const RELEASED_SPEC = `${PACKAGE_NAME}@${RELEASED_VERSION}`;
const VISIBILITY_TIMEOUT_SECONDS = 1;
const TAMPERED_INTEGRITY = "sha512-tampered";
const HTTP_SERVER_ERROR = 500;
const NPM_RELEASE = { changelog: false, createRelease: false, npm: true, push: false, tags: false };

const serveAsPublished: PackumentView = (packument) => packument;
const withholdVersion: PackumentView = () => undefined;
const serveDifferentArtifact: PackumentView = (packument) => {
  const version = packument.versions[RELEASED_VERSION];
  if (version) version.dist.integrity = TAMPERED_INTEGRITY;
  return packument;
};

type VisibilityCase = {
  name: string;
  timeout?: number;
  view: PackumentView;
  visible: boolean | null;
  warnings: string[];
  readsRegistry: boolean;
};

const cases: VisibilityCase[] = [
  {
    name: "reports a version served with the artifact integrity as visible",
    readsRegistry: true,
    timeout: VISIBILITY_TIMEOUT_SECONDS,
    view: serveAsPublished,
    visible: true,
    warnings: [],
  },
  {
    name: "completes with a warning when the registry withholds the version past the timeout",
    readsRegistry: true,
    timeout: VISIBILITY_TIMEOUT_SECONDS,
    view: withholdVersion,
    visible: false,
    warnings: [`${RELEASED_SPEC} is not visible`],
  },
  {
    name: "completes with a warning when the registry serves a different artifact",
    readsRegistry: true,
    timeout: VISIBILITY_TIMEOUT_SECONDS,
    view: serveDifferentArtifact,
    visible: false,
    warnings: [`${RELEASED_SPEC} on`, "does not match the integrity of the published artifact"],
  },
  {
    name: "skips the registry check by default",
    readsRegistry: false,
    view: serveAsPublished,
    visible: null,
    warnings: [],
  },
];

const invalidTimeouts: unknown[] = [-1, "300"];

async function rollJson(config: ConfigManager<SisyphusConfig>, args: Partial<RollCtx["args"]>) {
  const logged: string[] = [];
  const consoleLog = spyOn(console, "log").mockImplementation((value) => {
    logged.push(String(value));
  });
  try {
    await new RollCommand().execute(makeCtx(config, { ...args, json: true }));
  } finally {
    consoleLog.mockRestore();
  }
  return JSON.parse(logged.at(-1) as string);
}

describe("RollCommand npm visibility", () => {
  const originalCwd = process.cwd();
  let fixture: Fixture | undefined;
  let registry: FakeNpmRegistry | undefined;

  afterEach(() => {
    registry?.stop();
    registry = undefined;
    process.chdir(originalCwd);
    if (fixture) {
      rmSync(fixture.root, { force: true, recursive: true });
      rmSync(fixture.remote, { force: true, recursive: true });
    }
    fixture = undefined;
  });

  async function prepareRelease(view: PackumentView, timeout: unknown, publishStatus?: number) {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    registry = startFakeNpmRegistry(root, view, publishStatus);
    makePublishPackage(root, "packages/foo", PACKAGE_NAME);
    const config = makeConfig(root);
    if (timeout !== undefined) {
      config.set("release", { ...config.get("release"), npmVisibilityTimeout: timeout as number });
    }
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "publish foo with visibility timeout"`.quiet();
    return { config, registry, root };
  }

  test.each(cases)("$name", async ({ readsRegistry, timeout, view, visible, warnings }) => {
    const { config, registry } = await prepareRelease(view, timeout);

    const report = await rollJson(config, NPM_RELEASE);

    expect(report.status).toBe("completed");
    expect(report.publishedPackages).toEqual([{ name: PACKAGE_NAME, version: RELEASED_VERSION }]);
    expect(report.packages[0].visible).toBe(visible);
    expect(report.warnings).toHaveLength(warnings.length > 0 ? 1 : 0);
    for (const fragment of warnings) expect(report.warnings[0]).toContain(fragment);
    expect(registry.published).toEqual([PACKAGE_NAME]);
    expect(registry.readsAfterPublish.length > 0).toBe(readsRegistry);
  });

  test.each(invalidTimeouts)("rejects release.npmVisibilityTimeout %j before releasing", async (timeout) => {
    const { config, registry, root } = await prepareRelease(serveAsPublished, timeout);
    const baseline = await gitText(root, ["rev-parse", "HEAD"]);

    await expect(new RollCommand().execute(makeCtx(config, NPM_RELEASE))).rejects.toThrow(
      "Invalid release.npmVisibilityTimeout",
    );

    expect(await gitText(root, ["rev-parse", "HEAD"])).toBe(baseline);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
    expect(registry.published).toEqual([]);
  });

  test("resumes a publication npm reported as failed and checks its visibility", async () => {
    const { config, registry, root } = await prepareRelease(
      serveAsPublished,
      VISIBILITY_TIMEOUT_SECONDS,
      HTTP_SERVER_ERROR,
    );

    await expect(new RollCommand().execute(makeCtx(config, NPM_RELEASE))).rejects.toThrow(
      "Release incomplete after npm publication began",
    );
    expect((await ReleaseLedger.loadActive(root))?.data.operations.npm[PACKAGE_NAME]?.state).toBe("started");

    const report = await rollJson(config, { resume: true });

    expect(report.mode).toBe("resume");
    expect(report.status).toBe("completed");
    expect(report.publishedPackages).toEqual([{ name: PACKAGE_NAME, version: RELEASED_VERSION }]);
    expect(report.packages[0].visible).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(registry.published).toEqual([PACKAGE_NAME]);
    expect(await ReleaseLedger.loadActive(root)).toBeNull();
  });
});
