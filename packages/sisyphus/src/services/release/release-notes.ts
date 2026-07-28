import type { CommitInfo, Package, Stone } from "../../domain";

type CommitUrlFn = ((hash: string) => string) | null;

export function getProviderRelease(
  stones: Stone[],
  pkg: Package,
  commitUrlFn: CommitUrlFn,
): { notes: string; tag: string; title: string } {
  const version = pkg.newVersion ?? pkg.version;
  return {
    notes: formatReleaseNotes(filterStonesForPackage(stones, pkg.name), pkg, commitUrlFn),
    tag: `${pkg.name}@${version}`,
    title: `${pkg.name} v${version}`,
  };
}

export function filterStonesForPackage(stones: Stone[], packageName: string): Stone[] {
  return stones.filter((stone) => stone.affectsPackage(packageName));
}

export function formatReleaseNotes(stones: Stone[], pkg: Package, commitUrlFn: CommitUrlFn): string {
  const lines: string[] = [];
  const version = pkg.newVersion ?? pkg.version;

  lines.push(`\`${pkg.name}\` ${pkg.version} → ${version}`);

  if (stones.length === 0) return lines.join("\n");

  lines.push("");
  lines.push("<details>");
  lines.push(`<summary>Stones (${stones.length})</summary>`);
  lines.push("");

  for (const stone of stones) {
    lines.push(`### ${stone.message}`);
    lines.push("");
    if (stone.description) {
      lines.push(stone.description);
      lines.push("");
    }
    const commits = filterCommitsForPackage(stone.commits, pkg.name);
    if (commits.length > 0) {
      lines.push("<details>");
      lines.push(`<summary>Commits (${commits.length})</summary>`);
      lines.push("");
      for (const commit of commits) {
        lines.push(formatCommitLine(commit, commitUrlFn));
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  lines.push("</details>");

  return lines.join("\n");
}

export function filterCommitsForPackage(commits: readonly CommitInfo[] | undefined, packageName: string): CommitInfo[] {
  if (!commits) return [];
  return commits.filter((commit) => commit.packages.includes(packageName));
}

export function formatCommitLine(commit: CommitInfo, commitUrlFn: CommitUrlFn): string {
  const hashDisplay = commitUrlFn ? `[\`${commit.hash}\`](${commitUrlFn(commit.hash)})` : `\`${commit.hash}\``;
  return `- ${hashDisplay} ${commit.subject}`;
}
