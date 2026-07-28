import { BUMP_EMOJI, BumpType } from "../domain/BumpType";

const VERSION_INCREMENT = 1;
const VERSION_INITIAL = 1;
const DECIMAL_RADIX = 10;
const SNAPSHOT_DATE_REGEX = /[.ZT:-]/g;
const SNAPSHOT_DATE_LENGTH = 14;
const DEFAULT_SNAPSHOT_TAG = "nightly";

export class VersionCalculator {
  static bump(version: string, bump: BumpType, tag?: string): string {
    const [baseVersion = "0.0.0", tagVersion = ""] = version.split("-");
    const [currentTag = "", currentVersion = "0"] = tagVersion.split(".");

    if (bump === BumpType.Snapshot) {
      return VersionCalculator.formatSnapshot(tag);
    }

    if (tag && bump !== BumpType.Dependency) {
      return VersionCalculator.formatTagged(baseVersion, tag, currentTag, currentVersion);
    }

    if (bump === BumpType.Dependency && currentTag) {
      return VersionCalculator.formatTagged(baseVersion, currentTag, currentTag, currentVersion);
    }

    return VersionCalculator.bumpBase(baseVersion, bump);
  }

  static formatLabel(name: string, version: string, bump: BumpType, tag?: string, newVersion?: string): string {
    const nextVersion = newVersion ?? VersionCalculator.bump(version, bump, tag);
    const emoji = BUMP_EMOJI[bump];
    return `${name}@${version} => ${nextVersion} ${emoji}`;
  }

  private static formatSnapshot(tag?: string): string {
    const date = new Date().toISOString().replace(SNAPSHOT_DATE_REGEX, "").slice(0, SNAPSHOT_DATE_LENGTH);
    return `0.0.0-${tag || DEFAULT_SNAPSHOT_TAG}-${date}`;
  }

  private static formatTagged(baseVersion: string, tag: string, currentTag: string, currentVersion: string): string {
    const nextVersion =
      tag === currentTag ? Number.parseInt(currentVersion, DECIMAL_RADIX) + VERSION_INCREMENT : VERSION_INITIAL;
    return `${baseVersion}-${tag}.${nextVersion}`;
  }

  private static bumpBase(baseVersion: string, bump: BumpType): string {
    const [major = "0", minor = "0", patch = "0"] = baseVersion.split(".");
    const majorNum = Number.parseInt(major, DECIMAL_RADIX);
    const minorNum = Number.parseInt(minor, DECIMAL_RADIX);
    const patchNum = Number.parseInt(patch, DECIMAL_RADIX);

    switch (bump) {
      case BumpType.Major:
        return `${majorNum + VERSION_INCREMENT}.0.0`;
      case BumpType.Minor:
        return `${majorNum}.${minorNum + VERSION_INCREMENT}.0`;
      case BumpType.Dependency:
      case BumpType.Patch:
        return `${majorNum}.${minorNum}.${patchNum + VERSION_INCREMENT}`;
      default:
        return `${majorNum}.${minorNum}.${patchNum}`;
    }
  }
}
