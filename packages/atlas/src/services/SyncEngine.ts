import type {
  DiffStatus,
  EntryDiff,
  FileDiff,
  SyncResult,
  TrackedEntry,
} from "../types";

export type SyncDeps = {
  /** Compare a source file against its store snapshot, returning the diff status. */
  diffFile: (source: string, store: string) => Promise<DiffStatus>;
  /** Copy a tracked entry's files from source into the store. */
  copyToStore: (entry: TrackedEntry, storeDir: string) => Promise<number>;
  /** Copy a tracked entry's files from the store back to source. */
  copyFromStore: (entry: TrackedEntry, storeDir: string) => Promise<number>;
  /** List relative file paths within a directory (recursive). */
  listFiles: (dir: string) => Promise<string[]>;
  /** Check whether a path exists on disk. */
  exists: (path: string) => Promise<boolean>;
  /** Encrypt raw bytes with a password. */
  encrypt?: (data: Uint8Array, password: string) => Uint8Array;
  /** Decrypt raw bytes with a password. */
  decrypt?: (data: Uint8Array, password: string) => Uint8Array;
  /** Compress raw bytes. */
  compress?: (data: Uint8Array) => Uint8Array;
  /** Decompress raw bytes. */
  decompress?: (data: Uint8Array) => Uint8Array;
  /** Push the store (or staging) directory to the remote backend. */
  pushBackend: (storePath: string) => Promise<void>;
  /** Pull from the remote backend into the store (or staging) directory. */
  pullBackend: (storePath: string) => Promise<void>;
  /** Copy an entire directory tree from src to dest. */
  copyDir: (src: string, dest: string) => Promise<void>;
  /** Remove a directory tree. */
  rmDir: (dir: string) => Promise<void>;
  /** Read a file as raw bytes. */
  readFile: (path: string) => Promise<Uint8Array>;
  /** Write raw bytes to a file. */
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
};

export type SyncEngineOptions = {
  storeRoot: string;
  compression: boolean;
  encryption: { enabled: boolean; password?: string };
};

export class SyncEngine {
  constructor(
    private deps: SyncDeps,
    private options: SyncEngineOptions,
  ) {}

  /** Push local files to the store, then push the store to the backend. */
  async push(entries: TrackedEntry[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const entry of entries) {
      results.push(await this.pushEntry(entry));
    }

    const needsStaging = this.options.compression || this.needsEncryption();
    const pushPath = needsStaging
      ? await this.prepareStagingForPush()
      : this.options.storeRoot;

    try {
      await this.deps.pushBackend(pushPath);
    } finally {
      if (needsStaging) {
        await this.deps.rmDir(this.stagingDir());
      }
    }

    return results;
  }

  /** Pull from the backend into the store, then copy to local paths. */
  async pull(entries: TrackedEntry[]): Promise<SyncResult[]> {
    const needsStaging = this.options.compression || this.needsEncryption();
    const pullPath = needsStaging ? this.stagingDir() : this.options.storeRoot;

    await this.deps.pullBackend(pullPath);

    if (needsStaging) {
      await this.unstageFromPull();
    }

    const results: SyncResult[] = [];
    for (const entry of entries) {
      results.push(await this.pullEntry(entry));
    }
    return results;
  }

  /** Compute diff status for each tracked entry. */
  async status(entries: TrackedEntry[]): Promise<EntryDiff[]> {
    const diffs: EntryDiff[] = [];
    for (const entry of entries) {
      diffs.push(await this.diffEntry(entry));
    }
    return diffs;
  }

  /** Push a single entry from source into the store (no backend push). */
  async pushEntry(entry: TrackedEntry): Promise<SyncResult> {
    try {
      const storeDir = this.entryStoreDir(entry);
      const filesChanged = await this.deps.copyToStore(entry, storeDir);
      return { entry, success: true, filesChanged };
    } catch (err) {
      return {
        entry,
        success: false,
        filesChanged: 0,
        error: errorMessage(err),
      };
    }
  }

  /** Pull a single entry from the store to its source path. */
  async pullEntry(entry: TrackedEntry): Promise<SyncResult> {
    try {
      if (this.needsDecryption(entry)) {
        this.assertPassword("pull encrypted entry");
      }

      const storeDir = this.entryStoreDir(entry);
      const filesChanged = await this.deps.copyFromStore(entry, storeDir);
      return { entry, success: true, filesChanged };
    } catch (err) {
      return {
        entry,
        success: false,
        filesChanged: 0,
        error: errorMessage(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private entryStoreDir(entry: TrackedEntry): string {
    return `${this.options.storeRoot}/${entry.id}`;
  }

  private stagingDir(): string {
    return `${this.options.storeRoot}/.staging`;
  }

  private needsEncryption(): boolean {
    return this.options.encryption.enabled;
  }

  private needsDecryption(entry: TrackedEntry): boolean {
    return entry.encrypt && this.options.encryption.enabled;
  }

  private assertPassword(operation: string): string {
    const pw = this.options.encryption.password;
    if (!pw) {
      throw new Error(
        `Encryption password required to ${operation} but none was provided`,
      );
    }
    return pw;
  }

  /**
   * Build the staging directory by copying the store and applying
   * encryption/compression transforms for a push.
   */
  private async prepareStagingForPush(): Promise<string> {
    const staging = this.stagingDir();
    await this.deps.rmDir(staging);
    await this.deps.copyDir(this.options.storeRoot, staging);

    const files = await this.deps.listFiles(staging);

    for (const relPath of files) {
      if (relPath.startsWith(".staging")) continue;

      const fullPath = `${staging}/${relPath}`;
      let data = await this.deps.readFile(fullPath);

      if (this.needsEncryption() && this.deps.encrypt) {
        const pw = this.assertPassword("push");
        data = this.deps.encrypt(data, pw);
      }

      if (this.options.compression && this.deps.compress) {
        data = this.deps.compress(data);
      }

      await this.deps.writeFile(fullPath, data);
    }

    return staging;
  }

  /**
   * After pulling into staging, decompress/decrypt and write back
   * into the actual store.
   */
  private async unstageFromPull(): Promise<void> {
    const staging = this.stagingDir();
    const files = await this.deps.listFiles(staging);

    for (const relPath of files) {
      const stagingPath = `${staging}/${relPath}`;
      let data = await this.deps.readFile(stagingPath);

      if (this.options.compression && this.deps.decompress) {
        data = this.deps.decompress(data);
      }

      if (this.needsEncryption() && this.deps.decrypt) {
        const pw = this.assertPassword("pull");
        data = this.deps.decrypt(data, pw);
      }

      const storePath = `${this.options.storeRoot}/${relPath}`;
      await this.deps.writeFile(storePath, data);
    }

    await this.deps.rmDir(staging);
  }

  /** Compute a diff for a single tracked entry. */
  private async diffEntry(entry: TrackedEntry): Promise<EntryDiff> {
    const storeDir = this.entryStoreDir(entry);
    const sourceExists = await this.deps.exists(entry.source);
    const storeExists = await this.deps.exists(storeDir);

    if (sourceExists && !storeExists) {
      return { entry, status: "added", files: [] };
    }

    if (!sourceExists && storeExists) {
      return { entry, status: "deleted", files: [] };
    }

    if (!sourceExists && !storeExists) {
      return { entry, status: "unchanged", files: [] };
    }

    // Both exist: compare file-by-file
    const sourceFiles = await this.deps.listFiles(entry.source);
    const storeFiles = await this.deps.listFiles(storeDir);
    const storeFileSet = new Set(storeFiles);
    const allPaths = new Set([...sourceFiles, ...storeFiles]);

    const fileDiffs: FileDiff[] = [];

    for (const relPath of allPaths) {
      const srcPath = `${entry.source}/${relPath}`;
      const stoPath = `${storeDir}/${relPath}`;
      const inSource = sourceFiles.includes(relPath);
      const inStore = storeFileSet.has(relPath);

      if (inSource && !inStore) {
        fileDiffs.push({ path: relPath, status: "added" });
      } else if (!inSource && inStore) {
        fileDiffs.push({ path: relPath, status: "deleted" });
      } else {
        const status = await this.deps.diffFile(srcPath, stoPath);
        if (status !== "unchanged") {
          fileDiffs.push({ path: relPath, status });
        }
      }
    }

    const entryStatus: DiffStatus =
      fileDiffs.length === 0 ? "unchanged" : "modified";

    return { entry, status: entryStatus, files: fileDiffs };
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
