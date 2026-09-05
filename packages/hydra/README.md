# Hydra

Spawn and manage local self-hosted GitHub Actions runners.

[![npm version](https://img.shields.io/npm/v/@r5n/hydra.svg)](https://www.npmjs.com/package/@r5n/hydra) [![License](https://img.shields.io/npm/l/@r5n/hydra.svg)](./LICENSE)

Hydra registers runners against a GitHub repository or organization and runs them as background processes on the machine it runs on. All state lives in a `.hydra/` directory relative to your current working directory, so each directory you run it from is its own isolated runner fleet.

## Requirements

- Bun (the published CLI runs on Bun)
- `gh` CLI, installed and authenticated (`gh auth login`) — Hydra mints runner registration and removal tokens via `gh api`; it never asks for or stores a token itself. Repository runners need admin access to the repository; organization runners need the `admin:org` scope.
- `bash`, `curl`, `tar`
- macOS (Apple Silicon) or Linux (x64). A `win-x64` runner download mapping exists in the code, but registration and startup shell out to `bash config.sh` / `bash run.sh`, so Windows is not actually supported.

## Install

```bash
bun add -g @r5n/hydra
```

## Quick start

```bash
mkdir ~/runners && cd ~/runners
hydra init https://github.com/owner/repo -c 2
hydra create
hydra start
hydra status
```

Bare `hydra` prints help. `hydra -i` opens an interactive menu that walks through the same commands with prompts. `hydra help <command>` or `hydra <command> --help` shows per-command usage.

## Commands

### init

`hydra init [url]` writes a profile to `.hydra/config.json`. The first profile becomes the default. Run with no arguments it opens an interactive form; when any positional or piped input is involved the URL is required.

- `-p, --profile` profile name (default: `default`)
- `-n, --name` base name for runners (default: `runner`)
- `-c, --runners` number of runners (default: 1)
- `-l, --labels` comma-separated extra labels
- `-f, --force` overwrite an existing profile

### create

`hydra create [profile] [count]` downloads the latest `actions/runner` release (once per version, shared across runners), then registers runners named `<name>-1`, `<name>-2`, … It tops up to the target count: if the profile already has enough runners recorded, it does nothing. `count` overrides the profile's `numberOfMachines`.

### start / stop

`hydra start [profile] [ids...]` launches each runner's `run.sh` as a detached background process and records its pid. `hydra stop [profile] [ids...]` kills them. Omit the ids to target every runner in the profile; omit the profile to use the default. Runners do not survive a reboot — run `hydra start` again.

### status

`hydra status` lists every profile's runners with their state (`running` with pid, `registered`, or `unknown`). State is determined locally from pid liveness and the runner's `.runner` file; no API calls.

### logs

`hydra logs [id]` tails the newest job log (`Worker_*.log`) from the runner's `_diag` directory. If no job has run yet it falls back to the runner daemon log with a warning. The id can be omitted when there is exactly one runner.

- `-n, --lines` lines to tail (default: 100)
- `-r, --runner` show the runner daemon log (`Runner_*.log`) instead of the job log
- `-l, --list` list available log files with timestamps and sizes
- `-o, --open` open the log in `$EDITOR` (falls back to `open` on macOS)

### cleanup

`hydra cleanup` frees disk space. By default it prunes `_diag` log files older than 7 days (always keeping the newest runner and worker log per runner) and removes shared runner versions no runner's `externals` link points to (the newest installed version is always kept). `_work` holds job checkouts and caches, so it is never cleaned by default — pass `-w` explicitly. Runners that are currently running are skipped for `_work` cleanup.

- `-l, --logs` prune old `_diag` log files
- `-w, --work` delete `_work` contents of stopped runners
- `-s, --shared` remove unused shared runner versions
- `-d, --days` age threshold in days for log pruning (default: 7, or `cleanup.olderThanDays`)
- `-n, --dry-run` list what would be deleted with sizes, delete nothing
- `-y, --yes` skip confirmation prompts

Passing any of `-l`/`-w`/`-s` cleans only those targets; with none, the targets come from the `cleanup` config section (default: logs and shared).

### update

`hydra update` checks the latest `actions/runner` release, and if it differs from the installed version, swaps the binaries for every runner. Runners that were running are stopped, updated, and restarted.

### remove

`hydra remove [profile] [ids...]` stops the runners, deregisters them from GitHub, and deletes their directories.

### profile

- `hydra profile list` — profiles with URL, OS, and created/running counts
- `hydra profile default <name>` — set the default profile
- `hydra profile remove <name> [--yes]` — remove a profile; if it has runners, stops and deregisters them first. Pass `--yes` to skip confirmation in scripts.

## Configuration

`.hydra/config.json`, resolved relative to the working directory. Hydra writes it; the `profiles` section is safe to edit by hand:

```json
{
  "defaultProfile": "default",
  "profiles": {
    "default": {
      "url": "https://github.com/owner/repo",
      "name": "runner",
      "numberOfMachines": 2,
      "labels": "macOS,ARM64",
      "directory": ".hydra/runners",
      "os": "osx",
      "provider": "github",
      "overwrite": false,
      "run": false
    }
  },
  "runners": []
}
```

`os` is one of `osx` | `linux` | `windows` (auto-detected by `init`). An optional `runnerGroup` string is passed through to `config.sh --runnergroup`; runner groups only apply to organization runners. The `runners` array is Hydra's record of what it created — leave it alone.

An optional `cleanup` section controls `hydra cleanup` and automatic cleanup:

```json
"cleanup": { "auto": true, "intervalHours": 24, "olderThanDays": 7, "targets": ["logs", "shared"] }
```

All fields are optional; the values above (with `auto: false`) are the defaults. With `auto` enabled, `hydra start` and `hydra update` run a cleanup afterwards whenever the last run is more than `intervalHours` ago. Automatic runs never prompt and only touch the configured `targets` — `work` only if you list it explicitly. Hydra records `lastRun` itself; leave it alone.

The `url` is either a repository URL (`https://github.com/owner/repo`) or an organization URL (`https://github.com/org`). Repository URLs mint tokens from the repository endpoint (requires repo admin); organization URLs use the organization endpoint (requires the `admin:org` scope).

## How it works

Runner binaries are downloaded once per version into `.hydra/shared/github/<version>`. Each runner directory under `.hydra/runners/<id>` gets hardlinks for `bin`, a symlink for `externals`, and its own copies of the shell scripts, so ten runners cost roughly one copy of the runner distribution on disk. Start/stop is plain process management: a detached `bash run.sh` plus a pid file per runner.

Hydra disables the runner's automatic updater when registering it; use `hydra update` to update the shared binaries. Failed downloads are discarded, and completed registrations and removals are saved as each runner finishes, so a later failure in the batch can be retried. Failed deregistrations preserve the runner's files and record.

## License

Apache-2.0 — see [LICENSE](./LICENSE)
