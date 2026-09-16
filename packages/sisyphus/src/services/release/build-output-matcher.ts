export type BuildOutputMatcher = { isOutput: (repositoryPath: string) => boolean };

export const EMPTY_BUILD_OUTPUT_MATCHER: BuildOutputMatcher = { isOutput: () => false };

const RECURSIVE_SUFFIX = "**";

export function createBuildOutputMatcher(patterns: readonly string[]): BuildOutputMatcher {
  if (patterns.length === 0) return EMPTY_BUILD_OUTPUT_MATCHER;

  const globs = patterns.flatMap((pattern) => {
    const normalized = pattern.endsWith("/") ? `${pattern}${RECURSIVE_SUFFIX}` : pattern;
    if (normalized.endsWith(RECURSIVE_SUFFIX)) return [new Bun.Glob(normalized)];
    return [new Bun.Glob(normalized), new Bun.Glob(`${normalized}/${RECURSIVE_SUFFIX}`)];
  });

  return { isOutput: (repositoryPath) => globs.some((glob) => glob.match(repositoryPath)) };
}
