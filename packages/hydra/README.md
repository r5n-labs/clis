# Hydra

Spawn and manage local self-hosted GitHub Actions runners.

[![npm version](https://img.shields.io/npm/v/@r5n/hydra.svg)](https://www.npmjs.com/package/@r5n/hydra) [![License](https://img.shields.io/npm/l/@r5n/hydra.svg)](./LICENSE)

Hydra registers runners against a GitHub repository and runs them as background processes on the machine it runs on. All state lives in a `.hydra/` directory relative to your current working directory, so each directory you run it from is its own isolated runner fleet.

## Requirements

- Bun (the published CLI runs on Bun)
- `gh` CLI, installed and authenticated (`gh auth login`), with admin access to the target repository — Hydra mints runner registration and removal tokens via `gh api`; it never asks for or stores a token itself
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

`hydra init [url]` writes a profile to `.hydra/config.json`. The first profile becomes the default. With `-i` it runs as a form; non-interactively the URL positional is required.

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

### update

`hydra update` checks the latest `actions/runner` release, and if it differs from the installed version, swaps the binaries for every runner. Runners that were running are stopped, updated, and restarted.

### remove

`hydra remove [profile] [ids...]` stops the runners, deregisters them from GitHub, and deletes their directories.

### profile

- `hydra profile list` — profiles with URL, OS, and created/running counts
- `hydra profile default <name>` — set the default profile
- `hydra profile remove <name>` — remove a profile; if it has runners, stops and deregisters them first (after confirmation)

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

`os` is one of `osx` | `linux` | `windows` (auto-detected by `init`). An optional `runnerGroup` string is passed through to `config.sh --runnergroup`. The `runners` array is Hydra's record of what it created — leave it alone.

The `url` must be a repository URL (`https://github.com/owner/repo`). Registration tokens are fetched from the repository endpoint, so organization-level runners are not supported.

## How it works

Runner binaries are downloaded once per version into `.hydra/shared/github/<version>`. Each runner directory under `.hydra/runners/<id>` gets hardlinks for `bin`, a symlink for `externals`, and its own copies of the shell scripts, so ten runners cost roughly one copy of the runner distribution on disk. Start/stop is plain process management: a detached `bash run.sh` plus a pid file per runner.

## License

Apache-2.0 — see [LICENSE](./LICENSE)
