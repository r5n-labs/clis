import { Exit } from "@r5n/cli-core";
import type { ReleaseLedger, ReleaseLedgerPushOperation } from "../release-ledger";
import { getValidatedPushUrl, performAtomicPush, readRemoteRefs } from "./remote-url";
import { runInContext } from "./run";

const NOT_ANCESTOR_EXIT_CODE = 1;

export async function reconcileReleasePush(
  ledger: ReleaseLedger,
  operation: ReleaseLedgerPushOperation,
  repositoryRoot: () => Promise<string>,
): Promise<void> {
  const remoteRefs = await readRemoteRefs(operation, operation.refs, repositoryRoot);
  const pending: ReleaseLedgerPushOperation["refs"] = [];

  for (const ref of operation.refs) {
    const remoteOid = remoteRefs.get(ref.destination);
    if (remoteOid === ref.oid) continue;
    if (!remoteOid) {
      pending.push(ref);
      continue;
    }

    if (ref.destination.startsWith("refs/heads/")) {
      await fetchMissingCommit(remoteOid, operation, repositoryRoot);
      if (await isAncestor(ref.oid, remoteOid)) continue;
      if (await isAncestor(remoteOid, ref.oid)) {
        pending.push(ref);
        continue;
      }
    }

    throw new Exit(
      `Cannot safely resume remote push: ${ref.destination} is not at ${ref.oid}`,
      "The remote ref diverged from the recorded release; inspect it manually before resuming",
    );
  }

  if (pending.length > 0) await performAtomicPush({ ...operation, refs: pending }, repositoryRoot);
  await ledger.markPush("completed");
}

async function fetchMissingCommit(
  oid: string,
  operation: ReleaseLedgerPushOperation,
  repositoryRoot: () => Promise<string>,
): Promise<void> {
  const exists = await Bun.$`git cat-file -e ${`${oid}^{commit}`}`.quiet().nothrow();
  if (exists.exitCode === 0) return;

  const pushUrl = await getValidatedPushUrl(operation, repositoryRoot);
  await runInContext(
    () => Bun.$`git fetch --no-tags --no-write-fetch-head --no-recurse-submodules ${pushUrl} ${oid}`.quiet(),
    "Failed to inspect the remote branch ancestry",
  );
}

async function isAncestor(ancestor: string, descendant: string): Promise<boolean> {
  const result = await Bun.$`git merge-base --is-ancestor ${ancestor} ${descendant}`.quiet().nothrow();
  if (result.exitCode === 0) return true;
  if (result.exitCode === NOT_ANCESTOR_EXIT_CODE) return false;
  throw new Error(`Failed to inspect remote branch ancestry: ${result.stderr.toString().trim()}`);
}
