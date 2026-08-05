import { describe, expect, test } from "bun:test";
import { Exit } from "@r5n/cli-core";
import { Package } from "../../src/domain/Package";
import { Stone } from "../../src/domain/Stone";
import type { ReleaseLedgerData } from "../../src/services/release-ledger";
import { buildReleaseReport, RELEASE_REPORT_SCHEMA_VERSION } from "../../src/services/release-report";

const REPORT_KEYS = [
  "baseCommit",
  "command",
  "mode",
  "operations",
  "packages",
  "published",
  "publishedPackages",
  "releaseCommit",
  "releaseId",
  "schemaVersion",
  "status",
  "stones",
  "tags",
];

function makeLedger(overrides: Partial<ReleaseLedgerData> = {}): ReleaseLedgerData {
  return {
    artifacts: { "@app/cli": { integrity: "sha512-abc", path: "/tmp/cli.tgz" } },
    baseCommit: "b".repeat(40),
    createdAt: "2026-08-05T00:00:00.000Z",
    id: "release-1",
    operations: {
      npm: { "@app/cli": { completedAt: "x", startedAt: "y", state: "completed" } },
      npmRegistries: { "@app/cli": "https://registry.npmjs.org/" },
      providerReleases: {},
      push: {
        completedAt: "x",
        destination: { canonicalUrl: "https://github.com/app/repo" },
        refs: [],
        remote: "origin",
        startedAt: "y",
        state: "completed",
      },
    },
    options: {
      changelog: true,
      createRelease: false,
      dryRun: false,
      npm: true,
      npmTag: "latest",
      publishOnly: false,
      push: true,
      tags: true,
    },
    packages: [
      {
        file: "packages/cli/package.json",
        isPrivate: false,
        name: "@app/cli",
        newVersion: "1.1.0",
        oldVersion: "1.0.0",
      },
      {
        file: "packages/core/package.json",
        isPrivate: true,
        name: "@app/core",
        newVersion: "0.2.0",
        oldVersion: "0.1.0",
      },
    ],
    phase: "completed",
    releaseCommit: "c".repeat(40),
    releaseTags: ["@app/cli@1.1.0", "@app/core@0.2.0"],
    schemaVersion: 1,
    stones: [{ id: "0001-abcd", message: "ship" }],
    tagsReady: true,
    updatedAt: "2026-08-05T00:00:01.000Z",
    ...overrides,
  };
}

const baseInput = {
  mode: "release" as const,
  npmTag: "latest",
  packages: [],
  status: "completed" as const,
  stones: [],
  tagsEnabled: true,
};

describe("buildReleaseReport", () => {
  test("reports only npm operations that completed", () => {
    const report = buildReleaseReport({ ...baseInput, ledger: makeLedger() });

    expect(report.published).toBe(true);
    expect(report.publishedPackages).toEqual([{ name: "@app/cli", version: "1.1.0" }]);
  });

  test("excludes pending and started npm operations", () => {
    const ledger = makeLedger();
    ledger.operations.npm["@app/cli"] = { startedAt: "y", state: "started" };
    const report = buildReleaseReport({ ...baseInput, ledger });

    expect(report.published).toBe(false);
    expect(report.publishedPackages).toEqual([]);
  });

  test("keeps private packages visible but unpublished", () => {
    const report = buildReleaseReport({ ...baseInput, ledger: makeLedger() });
    const core = report.packages.find((pkg) => pkg.name === "@app/core");

    expect(core).toMatchObject({ integrity: null, private: true, published: false, registry: null });
    expect(core?.tag).toBe("@app/core@0.2.0");
  });

  test("takes identity, tags and stones from the ledger", () => {
    const report = buildReleaseReport({ ...baseInput, ledger: makeLedger() });

    expect(report).toMatchObject({
      baseCommit: "b".repeat(40),
      releaseCommit: "c".repeat(40),
      releaseId: "release-1",
      stones: ["0001-abcd"],
      tags: ["@app/cli@1.1.0", "@app/core@0.2.0"],
    });
    expect(report.operations).toEqual({ npmTag: "latest", providerReleases: false, pushed: true });
  });

  test("predicts tags for a ledger-less plan", () => {
    const packages = [
      new Package({ file: "packages/b/package.json", name: "@app/b", newVersion: "2.0.0", version: "1.0.0" }),
      new Package({ file: "packages/a/package.json", name: "@app/a", newVersion: "1.0.1", version: "1.0.0" }),
    ];
    const report = buildReleaseReport({
      ...baseInput,
      ledger: null,
      packages,
      status: "planned",
      stones: [Stone.fromJson({ id: "0001-abcd", message: "ship" })],
    });

    expect(report.releaseId).toBeNull();
    expect(report.status).toBe("planned");
    expect(report.tags).toEqual(["@app/a@1.0.1", "@app/b@2.0.0"]);
    expect(report.stones).toEqual(["0001-abcd"]);
  });

  test("omits predicted tags when tagging is disabled", () => {
    const packages = [new Package({ file: "a/package.json", name: "@app/a", newVersion: "1.0.1", version: "1.0.0" })];

    expect(buildReleaseReport({ ...baseInput, ledger: null, packages, tagsEnabled: false }).tags).toEqual([]);
  });

  test("attaches the message and hint of an Exit failure", () => {
    const report = buildReleaseReport({
      ...baseInput,
      error: new Exit("boom", "try again"),
      ledger: makeLedger(),
      status: "failed",
    });

    expect(report.error).toEqual({ hint: "try again", message: "boom" });
  });

  test("attaches only the message of a plain error", () => {
    const report = buildReleaseReport({ ...baseInput, error: new Error("boom"), ledger: null, status: "failed" });

    expect(report.error).toEqual({ message: "boom" });
  });

  test("emits a stable key set", () => {
    const report = buildReleaseReport({ ...baseInput, ledger: makeLedger() });

    expect(Object.keys(report).sort()).toEqual(REPORT_KEYS);
    expect(report.schemaVersion).toBe(RELEASE_REPORT_SCHEMA_VERSION);
  });
});
