import { color } from "@r5n/cli-core";

export enum BumpType {
  Major = "major",
  Minor = "minor",
  Patch = "patch",
  Dependency = "dependency",
  Snapshot = "snapshot",
}

export const BUMP_PRIORITY: Record<BumpType, number> = {
  [BumpType.Major]: 5,
  [BumpType.Minor]: 4,
  [BumpType.Patch]: 3,
  [BumpType.Dependency]: 2,
  [BumpType.Snapshot]: 1,
};

export const BUMP_EMOJI: Record<BumpType, string> = {
  [BumpType.Major]: "🚨",
  [BumpType.Minor]: "✨",
  [BumpType.Patch]: "🐛",
  [BumpType.Dependency]: "📦",
  [BumpType.Snapshot]: "📸",
};

export const BUMP_COLORS: Record<BumpType, (s: string) => string> = {
  [BumpType.Major]: color.red,
  [BumpType.Minor]: color.yellow,
  [BumpType.Patch]: color.green,
  [BumpType.Dependency]: color.blue,
  [BumpType.Snapshot]: color.magenta,
};

export const BUMP_ORDER = [
  BumpType.Major,
  BumpType.Minor,
  BumpType.Patch,
  BumpType.Dependency,
  BumpType.Snapshot,
] as const;

export function compareBumps(a: BumpType, b: BumpType): number {
  return BUMP_PRIORITY[a] - BUMP_PRIORITY[b];
}

export function higherBump(a: BumpType, b: BumpType): BumpType {
  return compareBumps(a, b) >= 0 ? a : b;
}

export function isBumpType(value: string): value is BumpType {
  return Object.values(BumpType).includes(value as BumpType);
}
