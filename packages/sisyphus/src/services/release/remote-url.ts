import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Exit } from "@r5n/cli-core";
import { parseRemoteUrl, type RemoteInfo } from "../../providers";
import type { ReleaseLedgerPushOperation, ReleaseLedgerRemoteDestination } from "../release-ledger";
import { runInContext } from "./run";

export type PushTarget = { branch: string; remote: string };

export async function resolveRemoteDestination(
  rawUrl: string,
  repositoryRoot: () => Promise<string>,
): Promise<ReleaseLedgerRemoteDestination> {
  const info = parseRemoteUrl(rawUrl);
  return {
    canonicalUrl: await canonicalizeRemoteUrl(rawUrl, repositoryRoot),
    ...(info ? { owner: info.owner, provider: info.provider, repo: info.repo } : {}),
  };
}

export async function canonicalizeRemoteUrl(rawUrl: string, repositoryRoot: () => Promise<string>): Promise<string> {
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    parsedUrl = null;
  }

  if (parsedUrl) {
    const sshScheme = parsedUrl.protocol === "ssh:" || parsedUrl.protocol === "git+ssh:";
    if (parsedUrl.password || (parsedUrl.username && !sshScheme)) {
      throw new Exit("Push URL contains embedded credentials", "Configure git authentication outside the remote URL");
    }
    parsedUrl.search = "";
    parsedUrl.hash = "";
    return parsedUrl.href;
  }

  const scp = rawUrl.match(/^(?:([^@/\s]+)@)?([^:/\s]+):(.+)$/);
  if (scp?.[2] && scp[3]) {
    const user = scp[1] ? `${scp[1]}@` : "";
    return `ssh://${user}${scp[2].toLowerCase()}/${scp[3].replace(/^\/+/, "")}`;
  }
  return pathToFileURL(resolve(await repositoryRoot(), rawUrl)).href;
}

export function getDestinationProvider(
  destination: ReleaseLedgerRemoteDestination | undefined,
): RemoteInfo | undefined {
  if (!destination?.provider || !destination.owner || !destination.repo) return undefined;
  return { owner: destination.owner, provider: destination.provider, repo: destination.repo };
}

export async function getSinglePushUrl(remote: string): Promise<string> {
  const result = await runInContext(
    () => Bun.$`git remote get-url --push --all ${remote}`.quiet(),
    `Failed to resolve push URL for ${remote}`,
  );
  const urls = result.stdout.toString().trim().split("\n").filter(Boolean);
  if (urls.length !== 1) {
    throw new Exit(
      `Push remote ${remote} must have exactly one push URL, found ${urls.length}`,
      "Remove additional push URLs before starting or resuming a release",
    );
  }
  const [url] = urls;
  if (!url) throw new Exit(`Push remote ${remote} has no URL`);
  return url;
}

export async function getValidatedPushUrl(
  operation: ReleaseLedgerPushOperation,
  repositoryRoot: () => Promise<string>,
): Promise<string> {
  const pushUrl = await getSinglePushUrl(operation.remote);
  const current = await resolveRemoteDestination(pushUrl, repositoryRoot);
  if (JSON.stringify(current) !== JSON.stringify(operation.destination)) {
    throw new Exit(
      `Push remote ${operation.remote} no longer matches the recorded release destination`,
      "Restore the original remote before resuming the release",
    );
  }
  return pushUrl;
}

export async function validatePushSources(
  refs: Array<{ source: string; destination: string; oid: string }>,
): Promise<void> {
  for (const ref of refs) {
    const result = await runInContext(
      () => Bun.$`git rev-parse ${ref.source}`.quiet(),
      `Failed to resolve ${ref.source}`,
    );
    const oid = result.stdout.toString().trim();
    if (oid !== ref.oid) {
      throw new Exit(
        `Release ref ${ref.source} points to ${oid}, expected ${ref.oid}`,
        "Do not move release refs before the release completes",
      );
    }
  }
}

export async function performAtomicPush(
  operation: ReleaseLedgerPushOperation,
  repositoryRoot: () => Promise<string>,
): Promise<void> {
  const pushUrl = await getValidatedPushUrl(operation, repositoryRoot);
  const refspecs = operation.refs.map((ref) => `${ref.oid}:${ref.destination}`);
  await runInContext(
    () => Bun.$`git push --atomic ${pushUrl} ${refspecs}`.quiet(),
    "Failed to atomically push release refs",
  );
}

export async function verifyRemoteRefs(
  operation: ReleaseLedgerPushOperation,
  repositoryRoot: () => Promise<string>,
  refs: ReleaseLedgerPushOperation["refs"] = operation.refs,
): Promise<void> {
  const remoteRefs = await readRemoteRefs(operation, refs, repositoryRoot);
  const mismatch = refs.find((ref) => remoteRefs.get(ref.destination) !== ref.oid);
  if (mismatch) {
    throw new Exit(
      `Cannot safely resume remote push: ${mismatch.destination} is not at ${mismatch.oid}`,
      "The previous push may not have completed; inspect the remote refs manually",
    );
  }
}

export async function readRemoteRefs(
  operation: ReleaseLedgerPushOperation,
  refs: ReleaseLedgerPushOperation["refs"],
  repositoryRoot: () => Promise<string>,
): Promise<Map<string, string>> {
  const pushUrl = await getValidatedPushUrl(operation, repositoryRoot);
  const destinations = refs.map((ref) => ref.destination);
  const result = await runInContext(
    () => Bun.$`git ls-remote --refs ${pushUrl} ${destinations}`.quiet(),
    "Failed to inspect remote release refs",
  );
  return new Map(
    result.stdout
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [oid = "", ref = ""] = line.split("\t");
        return [ref, oid] as const;
      }),
  );
}

export async function getCurrentBranchName(): Promise<string | undefined> {
  const result = await Bun.$`git symbolic-ref --quiet --short HEAD`.quiet().nothrow();
  if (result.exitCode !== 0) return undefined;
  return result.stdout.toString().trim() || undefined;
}

export async function resolvePushTarget(): Promise<PushTarget> {
  const branch = await getCurrentBranchName();
  if (!branch) {
    throw new Exit("Cannot push a release from detached HEAD", "Check out the branch that should receive the release");
  }

  return { branch, remote: await resolvePushRemote(branch) };
}

export async function resolvePushRemote(branch?: string): Promise<string> {
  const pushRemote = branch ? await readOptionalGitConfig(`branch.${branch}.pushRemote`) : null;
  const defaultRemote = await readOptionalGitConfig("remote.pushDefault");
  const trackingRemote = branch ? await readOptionalGitConfig(`branch.${branch}.remote`) : null;
  let remote = pushRemote ?? defaultRemote ?? trackingRemote;

  if (!remote) {
    const remotesResult = await runInContext(() => Bun.$`git remote`.quiet(), "Failed to list git remotes");
    const remotes = remotesResult.stdout.toString().trim().split("\n").filter(Boolean);
    if (remotes.length === 1 && remotes[0] === "origin") remote = "origin";
  }

  if (!remote) {
    const branchContext = branch ? ` for branch ${branch}` : "";
    throw new Exit(
      `No push remote is configured${branchContext}`,
      branch ? "Configure a branch push remote or remote.pushDefault" : "Configure remote.pushDefault",
    );
  }

  await runInContext(() => Bun.$`git remote get-url --push ${remote}`.quiet(), `Invalid push remote ${remote}`);
  return remote;
}

export async function readOptionalGitConfig(key: string): Promise<string | null> {
  const result = await Bun.$`git config --get ${key}`.quiet().nothrow();
  if (result.exitCode === 1) return null;
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(detail ? `Failed to read git config ${key}: ${detail}` : `Failed to read git config ${key}`);
  }

  const value = result.stdout.toString().trim();
  if (!value) throw new Error(`Git config ${key} is empty`);
  return value;
}
