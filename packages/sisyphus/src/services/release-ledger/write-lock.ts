import { randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS, readFileSync } from "node:fs";
import { link, lstat, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import type { LedgerWriteLock, StaleWriteLock, WriteLockMetadata } from "./types";
import {
  errorDetail,
  isCanonicalTimestamp,
  isErrorCode,
  PROC_STAT_START_TIME_INDEX,
  PROCESS_IDENTITY_PATTERN,
  ReleaseLedgerError,
  WRITE_LOCK_ACQUIRE_ATTEMPTS,
  WRITE_LOCK_OWNER_ID_PATTERN,
  WRITE_LOCK_SCHEMA_VERSION,
} from "./types";

export async function acquireLedgerWriteLock(directory: string): Promise<LedgerWriteLock> {
  const lockPath = join(directory, ".write.lock");

  for (let attempt = 0; attempt < WRITE_LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
    const processStartedAt = getProcessStartedAt(process.pid);
    if (!processStartedAt) {
      throw new ReleaseLedgerError("Failed to identify the release ledger lock owner process");
    }
    const metadata: WriteLockMetadata = {
      acquiredAt: new Date().toISOString(),
      hostname: hostname(),
      ownerId: randomUUID(),
      pid: process.pid,
      processStartedAt,
      schemaVersion: WRITE_LOCK_SCHEMA_VERSION,
    };
    const ownerPath = getWriteLockSidecarPath(directory, metadata.ownerId, "owner");
    await writeLockOwner(ownerPath, metadata);

    try {
      await link(ownerPath, lockPath);
    } catch (error) {
      await rm(ownerPath, { force: true });
      if (!isErrorCode(error, "EEXIST")) {
        throw new ReleaseLedgerError(`Failed to acquire release ledger lock at ${lockPath}: ${errorDetail(error)}`);
      }
      const stale = await inspectStaleWriteLock(lockPath);
      if (!stale) continue;
      await recoverStaleWriteLock(stale);
      continue;
    }

    const lock = { lockPath, metadata, ownerPath };
    try {
      await syncPath(directory);
      return lock;
    } catch (error) {
      try {
        await releaseLedgerWriteLock(lock);
      } catch (releaseError) {
        throw new AggregateError([error, releaseError], `Failed to durably acquire release ledger lock at ${lockPath}`);
      }
      throw new ReleaseLedgerError(
        `Failed to durably acquire release ledger lock at ${lockPath}: ${errorDetail(error)}`,
      );
    }
  }

  throw new ReleaseLedgerError(
    `Release ledger is locked by another process at ${lockPath}: lock changed during acquisition`,
  );
}

async function writeLockOwner(ownerPath: string, metadata: WriteLockMetadata): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(ownerPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf-8");
    await handle.sync();
  } catch (error) {
    await rm(ownerPath, { force: true });
    throw new ReleaseLedgerError(`Failed to create release ledger lock owner: ${errorDetail(error)}`);
  } finally {
    await handle?.close();
  }
  await syncPath(dirname(ownerPath));
}

async function inspectStaleWriteLock(lockPath: string): Promise<StaleWriteLock | null> {
  let lockStat: Awaited<ReturnType<typeof lstat>>;
  let lockContent: string;
  let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    lockHandle = await open(lockPath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    lockStat = await lockHandle.stat();
    lockContent = await lockHandle.readFile("utf-8");
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return null;
    throw new ReleaseLedgerError(`Failed to inspect release ledger lock at ${lockPath}: ${errorDetail(error)}`);
  } finally {
    await lockHandle?.close();
  }

  if (!lockStat.isFile()) {
    throw new ReleaseLedgerError(`Release ledger is locked by another process at ${lockPath}: lock owner is unknown`);
  }

  let metadata: WriteLockMetadata | null = null;
  try {
    metadata = parseWriteLockMetadata(JSON.parse(lockContent));
  } catch {
    metadata = null;
  }
  if (!metadata) return await failLocked(lockPath, lockStat, "lock metadata is malformed");
  const ownerPath = getWriteLockSidecarPath(dirname(lockPath), metadata.ownerId, "owner");
  const claimPath = getWriteLockSidecarPath(dirname(lockPath), metadata.ownerId, "claim");
  let ownerStat: Awaited<ReturnType<typeof lstat>>;
  try {
    ownerStat = await lstat(ownerPath);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      try {
        await lstat(claimPath);
      } catch (claimError) {
        if (isErrorCode(claimError, "ENOENT")) {
          return await failLocked(lockPath, lockStat, "stale lock ownership is incomplete");
        }
        throw new ReleaseLedgerError(`Failed to inspect release ledger lock claim: ${errorDetail(claimError)}`);
      }
      throw new ReleaseLedgerError(
        `Release ledger is locked by another process at ${lockPath}: stale lock recovery is incomplete (claim ${claimPath} remains; remove both after verifying the owner process is dead)`,
      );
    }
    throw new ReleaseLedgerError(`Failed to inspect release ledger lock owner: ${errorDetail(error)}`);
  }

  if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) {
    return await failLocked(lockPath, lockStat, "stale lock ownership is invalid");
  }

  let ownerMetadata: WriteLockMetadata | null = null;
  try {
    ownerMetadata = parseWriteLockMetadata(JSON.parse(await readFile(ownerPath, "utf-8")));
  } catch {
    ownerMetadata = null;
  }
  if (!ownerMetadata || !sameWriteLockMetadata(metadata, ownerMetadata)) {
    return await failLocked(lockPath, lockStat, "stale lock ownership is invalid");
  }

  if (!(await sameFileAtPath(lockPath, lockStat))) return null;

  if (!sameFileIdentity(lockStat, ownerStat)) {
    return { lockPath, lockStat, metadata, ownerPath, ownerStat };
  }
  if (metadata.hostname !== hostname()) {
    throw new ReleaseLedgerError(
      `Release ledger is locked by another process at ${lockPath}: lock owner is on an unknown host ${metadata.hostname} (pid ${metadata.pid})`,
    );
  }

  const liveness = getProcessLiveness(metadata);
  if (liveness === "alive") {
    throw new ReleaseLedgerError(
      `Release ledger is locked by another process at ${lockPath}: lock owner is still live (pid ${metadata.pid} on ${metadata.hostname})`,
    );
  }
  if (liveness === "unknown") {
    throw new ReleaseLedgerError(
      `Release ledger is locked by another process at ${lockPath}: lock owner liveness is unknown (pid ${metadata.pid} on ${metadata.hostname})`,
    );
  }
  return { lockPath, lockStat, metadata, ownerPath, ownerStat };
}

async function recoverStaleWriteLock(stale: StaleWriteLock): Promise<void> {
  const claimPath = getWriteLockSidecarPath(dirname(stale.lockPath), stale.metadata.ownerId, "claim");
  if (stale.ownerPath !== claimPath) {
    try {
      await rename(stale.ownerPath, claimPath);
      await syncPath(dirname(stale.lockPath));
    } catch (error) {
      if (isErrorCode(error, "ENOENT") || isErrorCode(error, "EEXIST")) return;
      throw new ReleaseLedgerError(`Failed to claim stale release ledger lock: ${errorDetail(error)}`);
    }
  }

  let currentStat: Awaited<ReturnType<typeof lstat>>;
  let claimStat: Awaited<ReturnType<typeof lstat>>;
  try {
    [currentStat, claimStat] = await Promise.all([lstat(stale.lockPath), lstat(claimPath)]);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return;
    throw new ReleaseLedgerError(`Failed to verify stale release ledger lock: ${errorDetail(error)}`);
  }

  if (!sameFileIdentity(stale.lockStat, currentStat)) return;
  if (!sameFileIdentity(stale.ownerStat, claimStat)) return;

  try {
    await unlink(stale.lockPath);
    await syncPath(dirname(stale.lockPath));
    await unlink(claimPath);
    await syncPath(dirname(stale.lockPath));
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return;
    throw new ReleaseLedgerError(`Failed to recover stale release ledger lock: ${errorDetail(error)}`);
  }
}

export async function releaseLedgerWriteLock(lock: LedgerWriteLock): Promise<void> {
  let lockStat: Awaited<ReturnType<typeof lstat>>;
  let ownerStat: Awaited<ReturnType<typeof lstat>>;

  try {
    [lockStat, ownerStat] = await Promise.all([lstat(lock.lockPath), lstat(lock.ownerPath)]);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      await rm(lock.ownerPath, { force: true });
      throw new ReleaseLedgerError("Failed to release ledger write lock: ownership record is missing");
    }
    throw new ReleaseLedgerError(`Failed to inspect release ledger lock during release: ${errorDetail(error)}`);
  }

  if (!sameFileIdentity(lockStat, ownerStat)) {
    await rm(lock.ownerPath, { force: true });
    throw new ReleaseLedgerError("Failed to release ledger write lock: ownership changed");
  }

  let currentMetadata: WriteLockMetadata | null = null;
  try {
    currentMetadata = parseWriteLockMetadata(JSON.parse(await readFile(lock.lockPath, "utf-8")));
  } catch {
    currentMetadata = null;
  }
  if (currentMetadata?.ownerId !== lock.metadata.ownerId) {
    throw new ReleaseLedgerError("Failed to release ledger write lock: owner identity changed");
  }

  try {
    await unlink(lock.lockPath);
    await unlink(lock.ownerPath);
    await syncPath(dirname(lock.lockPath));
  } catch (error) {
    throw new ReleaseLedgerError(`Failed to release ledger write lock: ${errorDetail(error)}`);
  }
}

function parseWriteLockMetadata(value: unknown): WriteLockMetadata | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (
    keys.length !== 6 ||
    !keys.every((key) =>
      ["acquiredAt", "hostname", "ownerId", "pid", "processStartedAt", "schemaVersion"].includes(key),
    ) ||
    object.schemaVersion !== WRITE_LOCK_SCHEMA_VERSION ||
    typeof object.ownerId !== "string" ||
    !WRITE_LOCK_OWNER_ID_PATTERN.test(object.ownerId) ||
    typeof object.hostname !== "string" ||
    !object.hostname ||
    typeof object.pid !== "number" ||
    !Number.isSafeInteger(object.pid) ||
    object.pid <= 0 ||
    typeof object.processStartedAt !== "string" ||
    !PROCESS_IDENTITY_PATTERN.test(object.processStartedAt) ||
    typeof object.acquiredAt !== "string" ||
    !isCanonicalTimestamp(object.acquiredAt)
  ) {
    return null;
  }
  return {
    acquiredAt: object.acquiredAt,
    hostname: object.hostname,
    ownerId: object.ownerId,
    pid: object.pid,
    processStartedAt: object.processStartedAt,
    schemaVersion: WRITE_LOCK_SCHEMA_VERSION,
  };
}

function getWriteLockSidecarPath(directory: string, ownerId: string, kind: "owner" | "claim"): string {
  if (!WRITE_LOCK_OWNER_ID_PATTERN.test(ownerId)) {
    throw new ReleaseLedgerError(
      `Release ledger is locked by another process at ${join(directory, ".write.lock")}: lock owner identity is malformed`,
    );
  }
  return join(directory, `.write.lock.${ownerId}.${kind}`);
}

function getProcessLiveness(metadata: WriteLockMetadata): "alive" | "dead" | "unknown" {
  try {
    process.kill(metadata.pid, 0);
  } catch (error) {
    return isErrorCode(error, "ESRCH") ? "dead" : "unknown";
  }

  const processStartedAt = getProcessStartedAt(metadata.pid);
  if (!processStartedAt) return "unknown";
  if (processStartedAt.split(":", 1)[0] !== metadata.processStartedAt.split(":", 1)[0]) return "unknown";
  return processStartedAt === metadata.processStartedAt ? "alive" : "dead";
}

function getProcessStartedAt(pid: number): string | null {
  if (process.platform === "linux") {
    try {
      const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf-8").trim();
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const commandEnd = stat.lastIndexOf(")");
      const startTime =
        commandEnd < 0
          ? undefined
          : stat
              .slice(commandEnd + 1)
              .trim()
              .split(/\s+/)[PROC_STAT_START_TIME_INDEX];
      if (bootId && startTime) return `linux:${bootId}:${startTime}`;
    } catch {}
  }

  if (process.platform === "win32") {
    try {
      const result = Bun.spawnSync({
        cmd: [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`,
        ],
        stderr: "pipe",
        stdout: "pipe",
      });
      const startedAt = result.stdout.toString().trim();
      if (result.exitCode === 0 && /^[0-9]+$/.test(startedAt)) return `windows:${startedAt}`;
    } catch {
      return null;
    }
  }

  try {
    const result = Bun.spawnSync({
      cmd: ["ps", "-o", "lstart=", "-p", String(pid)],
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      stderr: "pipe",
      stdout: "pipe",
    });
    if (result.exitCode !== 0) return null;
    const startedAt = result.stdout.toString().trim().replace(/\s+/g, " ");
    return startedAt ? `ps:${startedAt}` : null;
  } catch {
    return null;
  }
}

function sameFileIdentity(
  first: Awaited<ReturnType<typeof lstat>>,
  second: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

async function sameFileAtPath(path: string, expected: Awaited<ReturnType<typeof lstat>>): Promise<boolean> {
  try {
    return sameFileIdentity(expected, await lstat(path));
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return false;
    throw new ReleaseLedgerError(`Failed to verify release ledger lock at ${path}: ${errorDetail(error)}`);
  }
}

async function failLocked(
  lockPath: string,
  lockStat: Awaited<ReturnType<typeof lstat>>,
  detail: string,
): Promise<null> {
  if (!(await sameFileAtPath(lockPath, lockStat))) return null;
  throw new ReleaseLedgerError(`Release ledger is locked by another process at ${lockPath}: ${detail}`);
}

function sameWriteLockMetadata(first: WriteLockMetadata, second: WriteLockMetadata): boolean {
  return (
    first.schemaVersion === second.schemaVersion &&
    first.ownerId === second.ownerId &&
    first.hostname === second.hostname &&
    first.pid === second.pid &&
    first.processStartedAt === second.processStartedAt &&
    first.acquiredAt === second.acquiredAt
  );
}

export async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
