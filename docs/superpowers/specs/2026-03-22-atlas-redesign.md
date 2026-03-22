# Atlas CLI — Dotfiles & Config Sync Tool

## Overview

Atlas is a CLI for tracking, syncing, and bootstrapping dotfiles, configs, and package lists across machines. It replaces the previous codebase-scanner implementation with a config management tool.

## Domain Model

### TrackedEntry

A file or directory tracked by Atlas.

```typescript
type EntryType = "file" | "directory";

type TrackedEntry = {
  id: string;
  source: string;       // original path, e.g. "~/.zshrc"
  tags: string[];        // ["macos", "shell", "work"]
  type: EntryType;
  preset?: string;       // "brew" | "ssh" | "vscode" | null
  encrypt: boolean;
};
```

### BackendConfig

Where synced data is stored remotely.

```typescript
type BackendType = "git" | "gist" | "directory";

type GitBackend = { type: "git"; url: string; branch: string };
type GistBackend = { type: "gist"; gistId?: string; token?: string };
type DirectoryBackend = { type: "directory"; path: string };

type BackendConfig = GitBackend | GistBackend | DirectoryBackend;
```

### AtlasConfig

Root config stored at `~/.atlas/config.json`.

```typescript
type AtlasConfig = {
  $schema?: string;
  machine: string;                 // auto-detected hostname
  os: "macos" | "linux" | "windows";
  entries: TrackedEntry[];
  backend: BackendConfig;
  compression: boolean;
  encryption: { enabled: boolean; cipher: "aes-256-gcm" };
  activeTags: string[];
};
```

### PresetDef

Built-in and custom preset definitions.

```typescript
type PresetDef = {
  name: string;
  paths: string[];
  tags: string[];
  detect: () => boolean;
};
```

Built-in presets: `brew` (Brewfile), `ssh` (~/.ssh/config, keys), `git` (~/.gitconfig), `zsh` (~/.zshrc, ~/.zprofile), `fish` (~/.config/fish/), `nvim` (~/.config/nvim/), `vscode` (settings.json, keybindings.json).

## Commands

| Command | Description |
|---------|-------------|
| `atlas init` | Setup backend, detect OS, create config |
| `atlas track <path>` | Track file/dir, auto-tag OS |
| `atlas track --preset brew` | Track via preset |
| `atlas track --detect` | Auto-scan for known configs |
| `atlas untrack <path\|id>` | Remove from tracking |
| `atlas status` | Diff local vs store |
| `atlas update` | Sync all: local → store → backend |
| `atlas pull` | Backend → store → local |
| `atlas setup` | Bootstrap new machine from backend |
| `atlas list` | Show tracked entries with tags |
| `atlas backend` | Show/change backend config |

All commands with entry listing support `--tag <tags>` for filtering.

### init

- Detect OS (darwin/linux/win32 → macos/linux/windows)
- Detect hostname for `machine` field
- Interactive: choose backend type, configure it
- Non-interactive: `--backend git --url <url>` / `--backend gist` / `--backend dir --path <path>`
- `--profile <name>` sets initial activeTags

### track

- Resolve `~` and relative paths to absolute
- Auto-tag with OS (`macos`/`linux`) and hostname
- `--tags work,dev` adds custom tags
- `--encrypt` marks for encryption
- `--preset <name>` expands preset paths, applies preset tags
- `--detect` scans for all known presets, shows matches as multiselect
- Snapshots tracked file to `~/.atlas/store/{entry-id}/`

### update

- Iterates all entries (or filtered by `--tag`)
- DiffEngine compares local file vs store snapshot
- Changed files: update store, encrypt if needed, compress if enabled
- Push store to backend
- `--dry-run` shows what would change without acting

### pull

- Fetch from backend to store
- Decrypt/decompress as needed
- Copy store files to local paths
- Warns on conflicts (local file newer than store)

### setup

- Full bootstrap: pull + apply all entries
- Interactive mode: confirm each entry before applying
- `--tag macos,work` filters what to apply
- `--force` overwrites without confirmation

## Services

### EntryManager

CRUD for TrackedEntry list in config. Pattern follows `StoneManager`.

- `add(source, options)` — resolve path, create entry, snapshot
- `remove(idOrPath)` — remove entry from config, remove from store
- `list(tagFilter?)` — return entries, optionally filtered
- `get(idOrPath)` — find entry by id or source path
- `exists(source)` — check if path is already tracked

### StoreManager

Manages `~/.atlas/store/` — local mirror of tracked files.

- `snapshot(entry)` — copy source file/dir to store
- `restore(entry)` — copy store file/dir back to source
- `diff(entry)` — compare source vs store, return change status
- `getStorePath(entry)` — `~/.atlas/store/{entry.id}/`

### SyncEngine

Orchestrates sync flow.

- `push(entries)` — diff → update store → compress? → encrypt? → backend.push()
- `pull(entries)` — backend.pull() → decrypt? → decompress? → restore to local
- `status(entries)` — returns diff summary per entry

### DiffEngine

Compare local files against store snapshots.

- `diff(sourcePath, storePath)` — returns `"added" | "modified" | "deleted" | "unchanged"`
- For files: compare content hash (Bun.hash)
- For directories: recursive file-by-file comparison

### PresetRegistry

Manages built-in and custom presets.

- `getAll()` — return all preset definitions
- `get(name)` — get specific preset
- `detect()` — run detect() on all presets, return those that match

### Detector

Auto-detect installed configs on the machine.

- Uses PresetRegistry.detect()
- Returns list of detected presets with their paths
- Used by `atlas track --detect`

### Crypto

AES-256-GCM encryption with password-derived key (PBKDF2).

- `encrypt(data, password)` — returns encrypted buffer with salt+iv prepended
- `decrypt(data, password)` — returns decrypted buffer
- Uses `node:crypto` (available in Bun)

### Compression

Bun-native compression.

- `compress(data)` — `Bun.gzipSync(data)`
- `decompress(data)` — `Bun.gunzipSync(data)`

### Backend Adapters

```typescript
type BackendAdapter = {
  init(config: BackendConfig): Promise<void>;
  push(storePath: string): Promise<void>;
  pull(storePath: string): Promise<void>;
};
```

- **GitAdapter** — `git clone`/`pull`/`add`/`commit`/`push` to configured repo
- **GistAdapter** — GitHub API: create/update gist, download gist files
- **DirectoryAdapter** — cp/rsync store to/from target directory path

Factory: `createBackend(config: BackendConfig): BackendAdapter`

## Data Flow

```
track:   user path → EntryManager.add() → StoreManager.snapshot()
update:  DiffEngine.diff() → StoreManager.update() → Crypto? → Compress? → Backend.push()
pull:    Backend.pull() → Decompress? → Decrypt? → StoreManager.restore()
setup:   pull + apply all entries to filesystem
status:  DiffEngine.diff() per entry → display summary
```

## File Structure

```
packages/atlas/src/
  cli.ts                    # AtlasCLI extends AbstractCLI
  base-command.ts           # BaseCommand extends AbstractCommand<AtlasConfig>
  types.ts                  # all types
  constants.ts              # CLI_BIN, DEFAULT_CONFIG, presets paths
  commands/
    init.ts
    track.ts
    untrack.ts
    status.ts
    update.ts
    pull.ts
    setup.ts
    list.ts
    backend.ts
    index.ts                # barrel export
  services/
    EntryManager.ts
    StoreManager.ts
    SyncEngine.ts
    DiffEngine.ts
    PresetRegistry.ts
    Detector.ts
    Crypto.ts
    Compression.ts
    backends/
      types.ts              # BackendAdapter interface
      GitAdapter.ts
      GistAdapter.ts
      DirectoryAdapter.ts
      index.ts              # factory
  domain/
    presets.ts              # built-in preset definitions
    index.ts
```

## Auto-tagging Rules

When tracking, Atlas auto-adds:
- OS tag: `macos` | `linux` | `windows` (from `process.platform`)
- Machine tag: hostname (from `os.hostname()`)
- Preset tags: each preset defines its own (e.g. brew → `["packages", "macos"]`)

## What Gets Deleted

All current Atlas implementation:
- `services/CodebaseScanner.ts` — replaced by EntryManager + StoreManager
- `services/ImportAnalyzer.ts` — removed entirely
- `commands/map.ts` — removed
- `commands/explore.ts` — removed
- `commands/init.ts` — rewritten for new purpose
- `tests/` — rewritten for new services
- `types.ts` — rewritten with new domain types
- `constants.ts` — rewritten with new defaults

Kept: `cli.ts` (rewritten), `base-command.ts` (kept as-is), `build.ts`, `package.json`, `tsconfig.json`.
