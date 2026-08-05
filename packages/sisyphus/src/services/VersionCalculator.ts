import { Exit } from "@r5n/cli-core";
import { BUMP_EMOJI, BumpType } from "../domain/BumpType";
import {
  compareSemver,
  formatSemver,
  hasSameCore,
  incrementSemver,
  prereleaseCounter,
  prereleaseTag,
  requireSemver,
  type Semver,
  type SemverRelease,
  withPrerelease,
} from "../domain/semver";

const VERSION_INCREMENT = 1;
const PRERELEASE_INITIAL = 0;
const SNAPSHOT_DATE_REGEX = /[.ZT:-]/g;
const SNAPSHOT_DATE_LENGTH = 14;
const SNAPSHOT_BASE_VERSION = "0.0.0";
const SNAPSHOT_VERSION_PATTERN = /^0\.0\.0-[0-9A-Za-z.-]+-\d{14,}$/;
const PRERELEASE_IDENTIFIER_PATTERN = /^[0-9A-Za-z-]+$/;
const DEFAULT_SNAPSHOT_TAG = "nightly";

const BUMP_RELEASE: Partial<Record<BumpType, SemverRelease>> = {
  [BumpType.Dependency]: "patch",
  [BumpType.Major]: "major",
  [BumpType.Minor]: "minor",
  [BumpType.Patch]: "patch",
};

export class VersionCalculator {
  static bump(version: string, bump: BumpType, tag?: string, graduating = false): string {
    if (bump === BumpType.Snapshot) {
      return VersionCalculator.formatSnapshot(tag);
    }

    const operation = `apply a ${bump} bump`;
    const release = BUMP_RELEASE[bump];
    if (!release) {
      throw new Exit(`Unknown bump type "${bump}"`, "Use major, minor, patch, dependency, or snapshot");
    }

    if (VersionCalculator.isSnapshotVersion(version)) {
      throw new Exit(
        `Cannot ${operation} to snapshot version ${version}`,
        "Restore the package version from its last real release before releasing it again",
      );
    }

    const current = requireSemver(version, operation);
    const effectiveTag = VersionCalculator.resolveTag(current, bump, tag, graduating);
    const target = incrementSemver(current, release);
    const next =
      effectiveTag === undefined ? target : VersionCalculator.applyPrerelease(target, current, effectiveTag, version);

    if (compareSemver(next, current) <= 0) {
      throw new Exit(
        `A ${bump} bump would move ${version} to ${formatSemver(next)}, which is not a later version`,
        "Prerelease tags must increase in semver precedence (alpha < beta < rc)",
      );
    }

    return formatSemver(next);
  }

  static formatLabel(name: string, version: string, bump: BumpType, tag?: string, newVersion?: string): string {
    const nextVersion = newVersion ?? VersionCalculator.bump(version, bump, tag);
    const emoji = BUMP_EMOJI[bump];
    return `${name}@${version} => ${nextVersion} ${emoji}`;
  }

  static isSnapshotVersion(version: string): boolean {
    return SNAPSHOT_VERSION_PATTERN.test(version);
  }

  private static resolveTag(
    current: Semver,
    bump: BumpType,
    tag: string | undefined,
    graduating: boolean,
  ): string | undefined {
    if (tag !== undefined) return tag;
    if (graduating || bump !== BumpType.Dependency) return undefined;

    return prereleaseTag(current);
  }

  private static applyPrerelease(target: Semver, current: Semver, tag: string, version: string): Semver {
    if (!PRERELEASE_IDENTIFIER_PATTERN.test(tag)) {
      throw new Exit(
        `Invalid prerelease tag "${tag}"`,
        "A prerelease tag must be a single identifier of letters, digits, or hyphens",
      );
    }

    if (!hasSameCore(target, current)) {
      return withPrerelease(target, tag, PRERELEASE_INITIAL);
    }

    const counter = prereleaseCounter(current);
    if (prereleaseTag(current) === tag && counter !== undefined) {
      return withPrerelease(target, tag, counter + VERSION_INCREMENT);
    }

    if (current.prerelease[0] === tag) {
      const core = `${target.major}.${target.minor}.${target.patch}`;
      throw new Exit(
        `Cannot continue the "${tag}" prerelease from ${version}`,
        `Set the package version to ${core}-${tag}.<number> first`,
      );
    }

    return withPrerelease(target, tag, PRERELEASE_INITIAL);
  }

  private static formatSnapshot(tag?: string): string {
    const date = new Date().toISOString().replace(SNAPSHOT_DATE_REGEX, "").slice(0, SNAPSHOT_DATE_LENGTH);
    return `${SNAPSHOT_BASE_VERSION}-${tag || DEFAULT_SNAPSHOT_TAG}-${date}`;
  }
}
