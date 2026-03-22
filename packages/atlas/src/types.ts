// ── Entry ────────────────────────────────────────────

export type EntryType = "file" | "directory";

export type TrackedEntry = {
  id: string;
  source: string;
  tags: string[];
  type: EntryType;
  preset?: string;
  encrypt: boolean;
};

// ── Backend ─────────────────────────────────────────

export type BackendType = "git" | "gist" | "directory";

export type GitBackend = { type: "git"; url: string; branch: string };
export type GistBackend = { type: "gist"; gistId?: string; token?: string };
export type DirectoryBackend = { type: "directory"; path: string };

export type BackendConfig = GitBackend | GistBackend | DirectoryBackend;

// ── Encryption ──────────────────────────────────────

export type EncryptionConfig = {
  enabled: boolean;
  cipher: "aes-256-gcm";
};

// ── Config ──────────────────────────────────────────

export type OsType = "macos" | "linux" | "windows";

export type AtlasConfig = {
  $schema?: string;
  machine: string;
  os: OsType;
  entries: TrackedEntry[];
  backend: BackendConfig;
  compression: boolean;
  encryption: EncryptionConfig;
  activeTags: string[];
};

// ── Preset ──────────────────────────────────────────

export type PresetDef = {
  name: string;
  paths: string[];
  tags: string[];
  detect: () => boolean;
};

// ── Diff ────────────────────────────────────────────

export type DiffStatus = "added" | "modified" | "deleted" | "unchanged";

export type FileDiff = {
  path: string;
  status: DiffStatus;
};

export type EntryDiff = {
  entry: TrackedEntry;
  status: DiffStatus;
  files: FileDiff[];
};

// ── Sync ────────────────────────────────────────────

export type SyncResult = {
  entry: TrackedEntry;
  success: boolean;
  filesChanged: number;
  error?: string;
};
