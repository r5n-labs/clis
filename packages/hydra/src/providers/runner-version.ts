const EXTERNALS_VERSION_PATTERN = /(?:^|\/)github\/([^/]+)\/externals$/;

export function parseExternalsVersion(target: string): string | null {
  return target.match(EXTERNALS_VERSION_PATTERN)?.[1] ?? null;
}
