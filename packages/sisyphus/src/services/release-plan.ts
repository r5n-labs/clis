import { Exit } from "@r5n/cli-core";
import type { BumpType, Stone } from "../domain";
import { Package } from "../domain";
import type { DependencyKind } from "../types";
import { excludeIgnoredFromStone, isIgnoredPackage } from "./dependency-graph";

const PR_TITLE_MAX_ENTRIES = 6;

export type StonePlan = { stones: Stone[]; skipped: string[] };

export type EmptyReleaseReason = { kind: "ignored-only" } | { kind: "unknown-packages"; names: string[] };

export type StoneVersionPrediction = { name: string; version: string; bump: BumpType; newVersion: string };

export type StonePrediction = { kind: "ok"; packages: StoneVersionPrediction[] } | { kind: "invalid"; message: string };

export function stripIgnoredFromStones(stones: readonly Stone[], ignore: readonly string[]): StonePlan {
  const excluded = stones.map((stone) => excludeIgnoredFromStone(stone, ignore));

  return {
    skipped: [...new Set(excluded.flatMap((entry) => entry.skipped))].sort(),
    stones: excluded.map((entry) => entry.stone),
  };
}

export function explainEmptyRelease(
  merged: Stone,
  packages: ReadonlyMap<string, Package>,
  ignore: readonly string[],
): EmptyReleaseReason {
  const unknown = [...new Set(merged.allPackages)]
    .filter((name) => !packages.has(name) && !isIgnoredPackage(name, ignore))
    .sort();

  if (unknown.length > 0) return { kind: "unknown-packages", names: unknown };
  return { kind: "ignored-only" };
}

export function predictStoneVersions(
  stone: Stone,
  packages: Map<string, Package>,
  ignore: readonly string[],
  kinds?: readonly DependencyKind[],
): StonePrediction {
  const { stone: stripped } = excludeIgnoredFromStone(stone, ignore);
  const reason = explainEmptyRelease(stripped, packages, ignore);
  if (reason.kind === "unknown-packages") {
    return { kind: "invalid", message: `Pending stones reference unknown packages: ${reason.names.join(", ")}` };
  }

  try {
    const predicted = Package.applyStone(stripped, packages, kinds).flatMap((pkg) =>
      pkg.bump && pkg.newVersion
        ? [{ bump: pkg.bump, name: pkg.name, newVersion: pkg.newVersion, version: pkg.version }]
        : [],
    );
    return { kind: "ok", packages: predicted };
  } catch (error) {
    if (error instanceof Exit) return { kind: "invalid", message: error.message };
    throw error;
  }
}

export function buildReleasePrTitle(prefix: string, packages: readonly Package[]): string {
  const entries = packages.map((pkg) => `${pkg.name}@${pkg.newVersion ?? pkg.version}`);
  const shown = entries.slice(0, PR_TITLE_MAX_ENTRIES);
  const hidden = entries.length - shown.length;
  const suffix = hidden > 0 ? ` +${hidden} more` : "";

  return `${prefix} ${shown.join(", ")}${suffix}`;
}
