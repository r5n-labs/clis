type NpmPackEntry = { files?: unknown; filename?: unknown; name?: unknown; version?: unknown };

export function parseNpmPackOutput(stdout: string): NpmPackEntry | undefined {
  const parsed: unknown = JSON.parse(stdout);
  const entries: unknown[] = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed)
      : [];
  const [entry] = entries;
  return typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as NpmPackEntry) : undefined;
}
