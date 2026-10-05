import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { rmSync } from "node:fs";
import { RollCommand } from "../../src/commands/roll";
import { type FakeNpmRegistry, type PackumentView, startFakeNpmRegistry } from "../helpers/npm-registry";
import {
  type Fixture,
  makeConfig,
  makePublishPackage,
  PACKAGE_NAME,
  setupReleaseFixture,
} from "../helpers/release-orchestrator";
import { makeCtx } from "../helpers/roll";

const RELEASED_VERSION = "1.0.1";
const RELEASED_SPEC = `${PACKAGE_NAME}@${RELEASED_VERSION}`;
const VISIBILITY_TIMEOUT_SECONDS = 1;
const TAMPERED_INTEGRITY = "sha512-tampered";

const serveAsPublished: PackumentView = (packument) => packument;
const withholdVersion: PackumentView = () => undefined;
const serveDifferentArtifact: PackumentView = (packument) => {
  const version = packument.versions[RELEASED_VERSION];
  if (version) version.dist.integrity = TAMPERED_INTEGRITY;
  return packument;
};

type VisibilityCase = {
  name: string;
  timeout: number;
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
    timeout: 0,
    view: serveAsPublished,
    visible: null,
    warnings: [],
  },
];

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

  test.each(cases)("$name", async ({ readsRegistry, timeout, view, visible, warnings }) => {
    fixture = await setupReleaseFixture(false);
    const { root } = fixture;
    process.chdir(root);
    registry = startFakeNpmRegistry(root, view);
    makePublishPackage(root, "packages/foo", PACKAGE_NAME);
    const config = makeConfig(root);
    config.set("release", { ...config.get("release"), npmVisibilityTimeout: timeout });
    await Bun.$`git add -A`.quiet();
    await Bun.$`git commit -q -m "publish foo with visibility timeout"`.quiet();

    const logged: string[] = [];
    const consoleLog = spyOn(console, "log").mockImplementation((value) => {
      logged.push(String(value));
    });
    try {
      await new RollCommand().execute(
        makeCtx(config, { changelog: false, createRelease: false, json: true, npm: true, push: false, tags: false }),
      );
    } finally {
      consoleLog.mockRestore();
    }

    const report = JSON.parse(logged.at(-1) as string);
    expect(report.status).toBe("completed");
    expect(report.publishedPackages).toEqual([{ name: PACKAGE_NAME, version: RELEASED_VERSION }]);
    expect(report.packages[0].visible).toBe(visible);
    expect(report.warnings).toHaveLength(warnings.length > 0 ? 1 : 0);
    for (const fragment of warnings) expect(report.warnings[0]).toContain(fragment);
    expect(registry.published).toEqual([PACKAGE_NAME]);
    expect(registry.readsAfterPublish.length > 0).toBe(readsRegistry);
  });
});
