import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Exit } from "@r5n/cli-core";
import type { ReleaseLedgerData } from "../release-ledger";
import { getHeadCommit, toLiteralPathspec } from "./git-state";
import { runInContext } from "./run";

export async function writeExpectedReleaseTree(
  baseCommit: string,
  paths: readonly string[],
  repositoryRoot: string,
): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "sisyphus-index-"));
  const indexPath = join(tempDir, "index");
  const env = { ...process.env, GIT_INDEX_FILE: indexPath } as Record<string, string>;
  const pathspecs = paths.map((path) => toLiteralPathspec(path));

  try {
    await runInContext(
      () => Bun.$`git read-tree ${baseCommit}`.cwd(repositoryRoot).env(env).quiet(),
      "Failed to initialize release tree",
    );
    await runInContext(
      () => Bun.$`git add -A -- ${pathspecs}`.cwd(repositoryRoot).env(env).quiet(),
      "Failed to build release tree",
    );

    const result = await runInContext(
      () => Bun.$`git write-tree`.cwd(repositoryRoot).env(env).quiet(),
      "Failed to write release tree",
    );
    const tree = result.stdout.toString().trim();
    if (!tree) throw new Error("Git returned an empty release tree object ID");
    return tree;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

export async function validateReleaseCommit(data: ReleaseLedgerData): Promise<void> {
  if (!data.releaseCommit) {
    throw new Exit(
      `Release ${data.id} has no recorded source commit`,
      "No external operation will be retried; inspect the local release state manually",
    );
  }

  const head = await getHeadCommit();
  if (head !== data.releaseCommit) {
    throw new Exit(
      `Release ${data.id} was prepared from ${data.releaseCommit}, but HEAD is ${head}`,
      `Check out ${data.releaseCommit} before resuming`,
    );
  }
  if (!data.expectedReleaseTree) {
    throw new Exit(
      `Release ${data.id} has no recorded expected release tree`,
      "No external operation will be retried; inspect the release ledger manually",
    );
  }
  await validateReleaseCommitCandidate(data, head);
}

export async function validateReleaseCommitCandidate(data: ReleaseLedgerData, candidate: string): Promise<void> {
  if (!data.expectedReleaseTree) {
    throw new Exit(
      `Release ${data.id} has no recorded expected release tree`,
      "No external operation was attempted; inspect the release state manually",
    );
  }

  if (data.options.publishOnly) {
    if (candidate !== data.baseCommit) {
      throw new Exit(
        `Publish-only release ${data.id} must use commit ${data.baseCommit}, found ${candidate}`,
        `Check out ${data.baseCommit} before resuming`,
      );
    }
  } else {
    await validateCommitParent(candidate, data.baseCommit, data.id);
  }

  await validateCommitTree(candidate, data.expectedReleaseTree, data.id);
}

export async function validateCommitParent(commit: string, expectedParent: string, releaseId?: string): Promise<void> {
  const result = await runInContext(
    () => Bun.$`git rev-list --parents -n 1 ${commit}`.quiet(),
    "Failed to resolve release commit parent",
  );
  const [resolvedCommit, ...parents] = result.stdout.toString().trim().split(/\s+/);
  if (resolvedCommit === commit && parents.length === 1 && parents[0] === expectedParent) return;

  const release = releaseId ? ` for release ${releaseId}` : "";
  throw new Exit(
    `Release commit parent${release} does not match ${expectedParent}`,
    "No external operation was attempted; inspect the release commit ancestry",
  );
}

export async function validateCommitTree(commit: string, expectedTree: string, releaseId?: string): Promise<void> {
  const actualTree = await getCommitTree(commit);
  if (actualTree === expectedTree) return;

  const release = releaseId ? ` for release ${releaseId}` : "";
  throw new Exit(
    `Release commit tree${release} is ${actualTree}, expected ${expectedTree}`,
    "No external operation was attempted; inspect the release commit for unrelated tracked changes",
  );
}

export async function getCommitTree(commit: string): Promise<string> {
  const treeish = `${commit}^{tree}`;
  const result = await runInContext(
    () => Bun.$`git rev-parse ${treeish}`.quiet(),
    "Failed to resolve release commit tree",
  );
  const tree = result.stdout.toString().trim();
  if (!tree) throw new Error(`Git returned an empty tree object ID for ${commit}`);
  return tree;
}
