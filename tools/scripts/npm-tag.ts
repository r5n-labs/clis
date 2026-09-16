const SNAPSHOT_TIMESTAMP_SUFFIX = /-\d{14,}$/;

export function inferNpmPrereleaseTag(version: string): string | undefined {
  const withoutBuild = version.split("+")[0] ?? version;
  const separator = withoutBuild.indexOf("-");
  if (separator < 0) return undefined;

  const identifier = withoutBuild.slice(separator + 1).split(".")[0];
  return identifier?.replace(SNAPSHOT_TIMESTAMP_SUFFIX, "") || identifier;
}
