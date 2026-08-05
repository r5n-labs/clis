import { type ConfigManager, Exit } from "@r5n/cli-core";
import { SISYPHUS_DEFAULT_CONFIG } from "../constants";
import {
  BUMP_ORDER,
  BumpType,
  higherBump,
  isPrerelease,
  type Package,
  parseSemver,
  type Stone,
  WORKSPACE_PREFIX,
  type WorkspaceDependency,
} from "../domain";
import type { DependencyKind, SisyphusConfig, UpdateInternalPolicy } from "../types";
import { VersionCalculator } from "./VersionCalculator";

const EXACT_RANGE = "*";
const CARET_RANGE = "^";
const TILDE_RANGE = "~";

export type DependentSeed = { name: string; bump: BumpType };

export type DependentsOptions = {
  ignore?: readonly string[];
  kinds: readonly DependencyKind[];
  tag?: string;
  updateInternal?: UpdateInternalPolicy;
};

export type ReleaseOrder = { ordered: Package[]; cycle: string[] };

type ReverseEdge = { dependent: string; specifier: string };

const globCache = new Map<string, Bun.Glob>();

export function isIgnoredPackage(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pattern === name || matchesGlob(name, pattern));
}

export function dependentsOptions(config: ConfigManager<SisyphusConfig>, tag?: string): DependentsOptions {
  const dependents = config.get("dependents") ?? SISYPHUS_DEFAULT_CONFIG.dependents;

  return {
    ignore: config.get("ignore") ?? [],
    kinds: dependents.kinds,
    tag,
    updateInternal: dependents.updateInternal,
  };
}

export function isRangeInvalidated(specifier: string, oldVersion: string, newVersion: string): boolean {
  const range = specifier.slice(WORKSPACE_PREFIX.length);

  if (range === EXACT_RANGE) return oldVersion !== newVersion;
  if (range !== CARET_RANGE && range !== TILDE_RANGE) return false;

  const previous = parseSemver(oldVersion);
  const next = parseSemver(newVersion);

  if (!previous || !next) return true;
  if (isPrerelease(previous) || isPrerelease(next)) return true;
  if (previous.major !== next.major) return true;
  if (range === TILDE_RANGE) return previous.minor !== next.minor;
  if (previous.major !== 0) return false;
  if (previous.minor !== 0) return previous.minor !== next.minor;

  return previous.patch !== next.patch;
}

export function collectDependents(
  seeds: readonly DependentSeed[],
  packages: ReadonlyMap<string, Package>,
  options: DependentsOptions,
): string[] {
  const ignore = options.ignore ?? [];
  const reverse = buildReverseIndex(packages, new Set(options.kinds), ignore);
  const bumps = new Map<string, BumpType>();
  const seeded = new Set<string>();
  const queue: string[] = [];

  for (const seed of [...seeds].sort((left, right) => compareNames(left.name, right.name))) {
    if (!packages.has(seed.name) || isIgnoredPackage(seed.name, ignore)) continue;
    seeded.add(seed.name);
    if (raiseBump(bumps, seed.name, seed.bump)) enqueue(queue, seed.name);
  }

  while (queue.length > 0) {
    const name = queue.shift();
    if (!name) continue;

    const pkg = packages.get(name);
    const bump = bumps.get(name);
    const edges = reverse.get(name);
    if (!pkg || !bump || !edges) continue;

    const rangeAware = options.updateInternal === "outOfRange";
    const newVersion = rangeAware ? VersionCalculator.bump(pkg.version, bump, options.tag) : pkg.version;

    for (const edge of edges) {
      if (rangeAware && !isRangeInvalidated(edge.specifier, pkg.version, newVersion)) continue;
      if (raiseBump(bumps, edge.dependent, BumpType.Dependency)) enqueue(queue, edge.dependent);
    }
  }

  return [...bumps.keys()].filter((name) => !seeded.has(name)).sort(compareNames);
}

export function excludeIgnoredFromStone(stone: Stone, ignore: readonly string[]): { stone: Stone; skipped: string[] } {
  if (ignore.length === 0) return { skipped: [], stone };

  const skipped: string[] = [];
  let result = stone;

  for (const bump of BUMP_ORDER) {
    const current = stone.getPackages(bump);
    const kept = current.filter((name) => !isIgnoredPackage(name, ignore));
    if (kept.length === current.length) continue;

    skipped.push(...current.filter((name) => !kept.includes(name)));
    result = result.withPackages(bump, kept);
  }

  return { skipped: [...new Set(skipped)].sort(compareNames), stone: result };
}

export function excludeIgnored(
  packages: readonly Package[],
  ignore: readonly string[],
): { kept: Package[]; skipped: string[] } {
  if (ignore.length === 0) return { kept: [...packages], skipped: [] };

  const kept: Package[] = [];
  const skipped: string[] = [];

  for (const pkg of packages) {
    if (isIgnoredPackage(pkg.name, ignore)) skipped.push(pkg.name);
    else kept.push(pkg);
  }

  return { kept, skipped };
}

export function orderForRelease(packages: readonly Package[]): ReleaseOrder {
  const selected = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const names = [...selected.keys()].sort(compareNames);
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const name of names) {
    const dependencies = new Set(
      (selected.get(name)?.workspaceDependencies ?? [])
        .map((dependency) => dependency.name)
        .filter((dependency) => dependency !== name && selected.has(dependency)),
    );

    remaining.set(name, dependencies.size);
    for (const dependency of dependencies) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), name]);
    }
  }

  const ready = names.filter((name) => remaining.get(name) === 0);
  const ordered: Package[] = [];

  while (ready.length > 0) {
    const name = ready.shift();
    if (!name) continue;

    const pkg = selected.get(name);
    if (pkg) ordered.push(pkg);

    for (const dependent of dependents.get(name) ?? []) {
      const count = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, count);
      if (count === 0) enqueue(ready, dependent);
    }
  }

  const resolved = new Set(ordered.map((pkg) => pkg.name));
  const cycle = names.filter((name) => !resolved.has(name));

  for (const name of cycle) {
    const pkg = selected.get(name);
    if (pkg) ordered.push(pkg);
  }

  return { cycle, ordered };
}

function buildReverseIndex(
  packages: ReadonlyMap<string, Package>,
  kinds: ReadonlySet<DependencyKind>,
  ignore: readonly string[],
): Map<string, ReverseEdge[]> {
  const reverse = new Map<string, ReverseEdge[]>();

  for (const name of [...packages.keys()].sort(compareNames)) {
    if (isIgnoredPackage(name, ignore)) continue;

    for (const dependency of packages.get(name)?.workspaceDependencies ?? []) {
      if (!isReleaseBearing(dependency, kinds, packages, ignore)) continue;
      reverse.set(dependency.name, [
        ...(reverse.get(dependency.name) ?? []),
        { dependent: name, specifier: dependency.specifier },
      ]);
    }
  }

  return reverse;
}

function isReleaseBearing(
  dependency: WorkspaceDependency,
  kinds: ReadonlySet<DependencyKind>,
  packages: ReadonlyMap<string, Package>,
  ignore: readonly string[],
): boolean {
  if (!kinds.has(dependency.kind)) return false;
  if (!packages.has(dependency.name)) return false;

  return !isIgnoredPackage(dependency.name, ignore);
}

function raiseBump(bumps: Map<string, BumpType>, name: string, bump: BumpType): boolean {
  const current = bumps.get(name);
  const next = current === undefined ? bump : higherBump(current, bump);

  if (current !== undefined && next === current) return false;

  bumps.set(name, next);
  return true;
}

function enqueue(queue: string[], name: string): void {
  if (queue.includes(name)) return;

  const index = queue.findIndex((item) => compareNames(item, name) > 0);
  if (index < 0) queue.push(name);
  else queue.splice(index, 0, name);
}

function compareNames(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function matchesGlob(name: string, pattern: string): boolean {
  try {
    let glob = globCache.get(pattern);
    if (!glob) {
      glob = new Bun.Glob(pattern);
      globCache.set(pattern, glob);
    }
    return glob.match(name);
  } catch {
    throw new Exit(`Invalid ignore pattern "${pattern}"`, "Use a package name or a glob such as @scope/*");
  }
}
