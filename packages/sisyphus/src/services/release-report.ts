import { Exit } from "@r5n/cli-core";
import type { Package, Stone } from "../domain";
import type { ReleaseLedgerData } from "./release-ledger";

export const RELEASE_REPORT_SCHEMA_VERSION = 1 as const;

export type ReleaseReportMode = "abort" | "dry-run" | "preview" | "publish-only" | "release" | "resume";

export type ReleaseReportStatus = "aborted" | "completed" | "failed" | "planned" | "previewed";

export type ReleaseReportPackage = {
  name: string;
  oldVersion: string;
  newVersion: string;
  private: boolean;
  published: boolean;
  registry: string | null;
  tag: string | null;
  integrity: string | null;
};

export type ReleaseReport = {
  schemaVersion: typeof RELEASE_REPORT_SCHEMA_VERSION;
  command: "roll";
  mode: ReleaseReportMode;
  status: ReleaseReportStatus;
  published: boolean;
  publishedPackages: { name: string; version: string }[];
  packages: ReleaseReportPackage[];
  releaseId: string | null;
  baseCommit: string | null;
  releaseCommit: string | null;
  tags: string[];
  stones: string[];
  operations: { npmTag: string; pushed: boolean; providerReleases: boolean };
  changelogFiles?: string[];
  error?: { message: string; hint?: string; causes?: string[] };
};

export type ReleaseReportInput = {
  changelogFiles?: readonly string[];
  error?: unknown;
  ledger: ReleaseLedgerData | null;
  releaseCommit?: string;
  mode: ReleaseReportMode;
  npmTag: string;
  packages: readonly Package[];
  status: ReleaseReportStatus;
  stones: readonly Stone[];
  tagsEnabled: boolean;
};

export function buildReleaseReport(input: ReleaseReportInput): ReleaseReport {
  const { ledger } = input;
  const packages = ledger ? fromLedger(ledger) : fromPlan(input.packages);
  const publishedPackages = packages
    .filter((pkg) => pkg.published)
    .map((pkg) => ({ name: pkg.name, version: pkg.newVersion }));

  const report: ReleaseReport = {
    baseCommit: ledger?.baseCommit ?? null,
    command: "roll",
    mode: input.mode,
    operations: {
      npmTag: ledger?.options.npmTag ?? input.npmTag,
      providerReleases: hasCompletedProviderReleases(ledger),
      pushed: ledger?.operations.push?.state === "completed",
    },
    packages,
    published: publishedPackages.length > 0,
    publishedPackages,
    releaseCommit: ledger?.releaseCommit ?? input.releaseCommit ?? null,
    releaseId: ledger?.id ?? null,
    schemaVersion: RELEASE_REPORT_SCHEMA_VERSION,
    status: input.status,
    stones: ledger ? ledger.stones.map((stone) => stone.id) : input.stones.map((stone) => stone.id),
    tags: ledger ? (ledger.tagsReady ? [...ledger.releaseTags] : []) : predictTags(input.packages, input.tagsEnabled),
  };

  if (input.changelogFiles) report.changelogFiles = [...input.changelogFiles];
  if (input.error !== undefined) report.error = describeError(input.error);

  return report;
}

function fromLedger(ledger: ReleaseLedgerData): ReleaseReportPackage[] {
  return ledger.packages.map((pkg) => ({
    integrity: ledger.artifacts[pkg.name]?.integrity ?? null,
    name: pkg.name,
    newVersion: pkg.newVersion,
    oldVersion: pkg.oldVersion,
    private: pkg.isPrivate,
    published: ledger.operations.npm[pkg.name]?.state === "completed",
    registry: ledger.operations.npmRegistries[pkg.name] ?? null,
    tag: ledger.releaseTags.find((tag) => tag === `${pkg.name}@${pkg.newVersion}`) ?? null,
  }));
}

function fromPlan(packages: readonly Package[]): ReleaseReportPackage[] {
  return packages.map((pkg) => ({
    integrity: null,
    name: pkg.name,
    newVersion: pkg.newVersion ?? pkg.version,
    oldVersion: pkg.version,
    private: pkg.isPrivate,
    published: false,
    registry: null,
    tag: null,
  }));
}

function predictTags(packages: readonly Package[], tagsEnabled: boolean): string[] {
  if (!tagsEnabled) return [];
  return packages.map((pkg) => `${pkg.name}@${pkg.newVersion ?? pkg.version}`).sort();
}

function hasCompletedProviderReleases(ledger: ReleaseLedgerData | null): boolean {
  const releases = Object.values(ledger?.operations.providerReleases ?? {});
  return releases.length > 0 && releases.every((release) => release.state === "completed");
}

function describeError(error: unknown): { message: string; hint?: string; causes?: string[] } {
  const message = error instanceof Error ? error.message : String(error);
  const hint = error instanceof Exit ? error.hint : undefined;
  const causes = collectCauses(error);

  return { ...(causes.length > 0 ? { causes } : {}), ...(hint ? { hint } : {}), message };
}

function collectCauses(error: unknown, seen = new Set<unknown>()): string[] {
  if (!(error instanceof Error) || seen.has(error)) return [];
  seen.add(error);

  const nested = error instanceof AggregateError ? error.errors : [];
  const causes = [...nested, error.cause].filter((cause): cause is Error => cause instanceof Error);

  return causes.flatMap((cause) => [cause.message, ...collectCauses(cause, seen)]);
}
