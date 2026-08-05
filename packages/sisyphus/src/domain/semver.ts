import { Exit } from "@r5n/cli-core";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NUMERIC_IDENTIFIER_PATTERN = /^(0|[1-9]\d*)$/;

const DECIMAL_RADIX = 10;
const VERSION_INCREMENT = 1;
const CANONICAL_PRERELEASE_LENGTH = 2;

export type SemverIdentifier = string | number;

export type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly SemverIdentifier[];
  build: readonly string[];
};

export type SemverRelease = "major" | "minor" | "patch";

export function parseSemver(version: string): Semver | null {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return null;

  const [, major = "0", minor = "0", patch = "0", prerelease, build] = match;

  return {
    build: build ? build.split(".") : [],
    major: Number.parseInt(major, DECIMAL_RADIX),
    minor: Number.parseInt(minor, DECIMAL_RADIX),
    patch: Number.parseInt(patch, DECIMAL_RADIX),
    prerelease: prerelease ? prerelease.split(".").map(toIdentifier) : [],
  };
}

export function requireSemver(version: string, operation: string): Semver {
  const parsed = parseSemver(version);
  if (parsed) return parsed;

  throw new Exit(
    `Cannot ${operation}: "${version}" is not a valid version`,
    'Set the package version to MAJOR.MINOR.PATCH (no leading "v") before releasing',
  );
}

export function formatSemver(version: Semver): string {
  const prerelease = version.prerelease.length > 0 ? `-${version.prerelease.join(".")}` : "";
  const build = version.build.length > 0 ? `+${version.build.join(".")}` : "";

  return `${version.major}.${version.minor}.${version.patch}${prerelease}${build}`;
}

export function isPrerelease(version: Semver): boolean {
  return version.prerelease.length > 0;
}

export function hasSameCore(left: Semver, right: Semver): boolean {
  return left.major === right.major && left.minor === right.minor && left.patch === right.patch;
}

export function compareSemver(left: Semver, right: Semver): number {
  const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  if (core !== 0) return core < 0 ? -1 : 1;

  return comparePrerelease(left.prerelease, right.prerelease);
}

export function incrementSemver(version: Semver, release: SemverRelease): Semver {
  const prerelease = isPrerelease(version);

  if (release === "major") {
    const keepsCore = prerelease && version.minor === 0 && version.patch === 0;
    return emptyMetadata(keepsCore ? version.major : version.major + VERSION_INCREMENT, 0, 0);
  }

  if (release === "minor") {
    const keepsCore = prerelease && version.patch === 0;
    return emptyMetadata(version.major, keepsCore ? version.minor : version.minor + VERSION_INCREMENT, 0);
  }

  return emptyMetadata(version.major, version.minor, prerelease ? version.patch : version.patch + VERSION_INCREMENT);
}

export function withPrerelease(version: Semver, tag: string, counter: number): Semver {
  return { ...version, build: [], prerelease: [tag, counter] };
}

export function prereleaseTag(version: Semver): string | undefined {
  return canonicalPrerelease(version)?.tag;
}

export function prereleaseCounter(version: Semver): number | undefined {
  return canonicalPrerelease(version)?.counter;
}

function canonicalPrerelease(version: Semver): { tag: string; counter: number } | undefined {
  if (version.prerelease.length !== CANONICAL_PRERELEASE_LENGTH) return undefined;

  const [tag, counter] = version.prerelease;
  if (typeof tag !== "string" || typeof counter !== "number") return undefined;

  return { counter, tag };
}

function emptyMetadata(major: number, minor: number, patch: number): Semver {
  return { build: [], major, minor, patch, prerelease: [] };
}

function toIdentifier(part: string): SemverIdentifier {
  return NUMERIC_IDENTIFIER_PATTERN.test(part) ? Number.parseInt(part, DECIMAL_RADIX) : part;
}

function comparePrerelease(left: readonly SemverIdentifier[], right: readonly SemverIdentifier[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = typeof leftPart === "number";
    const rightNumeric = typeof rightPart === "number";

    if (leftNumeric && rightNumeric) return leftPart < rightPart ? -1 : 1;
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;

    return leftPart < rightPart ? -1 : 1;
  }

  return 0;
}
