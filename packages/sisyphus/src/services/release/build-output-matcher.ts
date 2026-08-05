export type BuildOutputMatcher = { isOutput: (repositoryPath: string) => boolean };

export const EMPTY_BUILD_OUTPUT_MATCHER: BuildOutputMatcher = { isOutput: () => false };

export function createBuildOutputMatcher(patterns: readonly string[]): BuildOutputMatcher {
  if (patterns.length === 0) return EMPTY_BUILD_OUTPUT_MATCHER;

  const globs = patterns.map((pattern) => new Bun.Glob(pattern.endsWith("/") ? `${pattern}**` : pattern));

  return { isOutput: (repositoryPath) => globs.some((glob) => glob.match(repositoryPath)) };
}
