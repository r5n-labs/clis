import { dirname } from "node:path";
import { Exit } from "@r5n/cli-core";
import type { ReleaseLedgerData } from "../release-ledger";
import { getScopeRegistryArgs, readPublishedPackage } from "./npm-registry";

const MILLISECONDS_PER_SECOND = 1000;
const POLL_INTERVAL_MS = 5000;

export type NpmVisibilityState = "mismatch" | "pending" | "visible";

export type NpmVisibility = { name: string; registry: string; state: NpmVisibilityState; version: string };

type VisibilityTarget = { cwd: string; integrity: string; name: string; registry: string; version: string };

export function resolveNpmVisibilityTimeout(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Exit(
    `Invalid release.npmVisibilityTimeout: ${JSON.stringify(value)}`,
    "Use a whole number of seconds, or 0 to skip the registry visibility check",
  );
}

export async function awaitNpmVisibility(ledger: ReleaseLedgerData, timeoutSeconds: number): Promise<NpmVisibility[]> {
  const targets = timeoutSeconds > 0 ? collectTargets(ledger) : [];
  if (targets.length === 0) return [];

  const deadline = Date.now() + timeoutSeconds * MILLISECONDS_PER_SECOND;
  const states = new Map<string, NpmVisibilityState>();
  let pending = targets;
  while (pending.length > 0) {
    for (const target of pending) states.set(target.name, await probe(target));
    pending = pending.filter((target) => states.get(target.name) === "pending");
    const remaining = deadline - Date.now();
    if (pending.length === 0 || remaining <= 0) break;
    await Bun.sleep(Math.min(POLL_INTERVAL_MS, remaining));
  }

  return targets.map(({ name, registry, version }) => ({
    name,
    registry,
    state: states.get(name) ?? "pending",
    version,
  }));
}

export function describeNpmVisibility(results: readonly NpmVisibility[], timeoutSeconds: number): string[] {
  return results
    .filter((result) => result.state !== "visible")
    .map((result) => {
      const spec = `${result.name}@${result.version}`;
      return result.state === "mismatch"
        ? `${spec} on ${result.registry} does not match the integrity of the published artifact`
        : `${spec} is not visible on ${result.registry} after ${timeoutSeconds}s; npm may still be processing or holding it`;
    });
}

function collectTargets(ledger: ReleaseLedgerData): VisibilityTarget[] {
  return ledger.packages.flatMap((pkg) => {
    const artifact = ledger.artifacts[pkg.name];
    const registry = ledger.operations.npmRegistries[pkg.name];
    const published = ledger.operations.npm[pkg.name]?.state === "completed";
    return published && artifact && registry
      ? [{ cwd: dirname(pkg.file), integrity: artifact.integrity, name: pkg.name, registry, version: pkg.newVersion }]
      : [];
  });
}

async function probe(target: VisibilityTarget): Promise<NpmVisibilityState> {
  const spec = `${target.name}@${target.version}`;
  const scopeRegistryArgs = getScopeRegistryArgs(target.name, target.registry);
  const result = await Bun.$`npm view ${spec} --json --prefer-online --registry ${target.registry} ${scopeRegistryArgs}`
    .cwd(target.cwd)
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) return "pending";

  const published = readPublishedPackage(parseJson(result.stdout.toString()));
  if (!published || published.name !== target.name || published.version !== target.version) return "pending";
  return published.integrity === target.integrity ? "visible" : "mismatch";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
