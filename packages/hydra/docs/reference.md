# Command and configuration reference

[Hydra](../README.md) / Command and configuration reference

## Commands

### init

`hydra init [url]` writes a profile to `.hydra/config.json`. The first profile becomes the default. Run with no arguments it opens an interactive form; when any positional or piped input is involved the URL is required.

- `-p, --profile` profile name (default: `default`)
- `-n, --name` base name for runners (default: `runner`)
- `-c, --runners` number of runners (default: 1)
- `-l, --labels` comma-separated extra labels
- `-f, --force` overwrite an existing profile

### create

`hydra create [profile] [count]` downloads the latest `actions/runner` release (once per version, shared across runners), then registers runners named `<name>-1`, `<name>-2`, … and installs their [job hooks](#job-hooks). It tops up to the target count: if the profile already has enough runners recorded, it does nothing. `count` overrides the profile's `numberOfMachines`.

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

`hydra update` checks the latest `actions/runner` release and swaps the binaries of every runner on an older version; runners that were running are stopped, updated and restarted. It also rewrites every runner's [job hooks](#job-hooks) from its profile, including runners already on the latest version. The runner reads `.env` only when it starts, so when a running runner's hook settings change, `update` prints the `hydra stop` and `hydra start` commands that restart it instead of interrupting its job.

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
      "jobHooks": {
        "dns": {
          "enabled": true,
          "hosts": ["github.com", "api.github.com", "objects.githubusercontent.com", "pipelines.actions.githubusercontent.com"],
          "timeoutSeconds": 120
        }
      },
      "os": "osx",
      "provider": "github",
      "overwrite": false,
      "run": false
    }
  },
  "runners": []
}
```

`os` is one of `osx` | `linux` | `windows` (auto-detected by `init`). An optional `runnerGroup` string is passed through to `config.sh --runnergroup`; runner groups only apply to organisation runners. The `runners` array is Hydra's record of what it created — leave it alone.

An optional `cleanup` section controls `hydra cleanup` and automatic cleanup:

```json
"cleanup": { "auto": true, "intervalHours": 24, "olderThanDays": 7, "targets": ["logs", "shared"] }
```

All fields are optional; the values above (with `auto: false`) are the defaults. With `auto` enabled, `hydra start` and `hydra update` run a cleanup afterwards whenever the last run is more than `intervalHours` ago. Automatic runs never prompt and only touch the configured `targets` — `work` only if you list it explicitly. Hydra records `lastRun` itself; leave it alone.

The `url` is either a repository URL (`https://github.com/owner/repo`) or an organisation URL (`https://github.com/org`). Repository URLs mint tokens from the repository endpoint (requires repo admin); organisation URLs use the organisation endpoint (requires the `admin:org` scope).

## Job hooks

Hydra installs its own scripts as the runner's [job hooks](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts). The runner runs the job-started hook as a "Set up runner" step at the start of every job and the job-completed hook as a "Complete runner" step at the end, and fails the job when a hook exits non-zero. `hydra create` writes the scripts into `<runner>/hydra-hooks/` after registration, `hydra update` rewrites them from the profile, and both point the runner's `.env` at them (`ACTIONS_RUNNER_HOOK_JOB_STARTED`). New profiles get the `jobHooks` section from `hydra init`; profiles without one use the defaults below.

While a hook is enabled Hydra owns its `.env` key and replaces any other value; the other `.env` lines are left alone. Disabling a hook removes Hydra's line and turns its script into a no-op, so runners that are still running keep finding it until they restart. Script changes apply from the next job; `.env` changes apply when the runner restarts.

### DNS wait

`jobHooks.dns` makes every job wait for DNS before it starts. The script looks up each host with `dscacheutil -q host -a name` (`getent hosts` where `dscacheutil` does not exist) and retries the unresolved ones every second. If it had to wait, it prints `::warning::DNS recovered after N s`. If the hosts do not all resolve within `timeoutSeconds`, it prints an `::error::` annotation naming them and exits 1, which fails the job before checkout. When neither lookup command exists it prints a warning and lets the job run.

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Install the DNS wait hook |
| `hosts` | `github.com`, `api.github.com`, `objects.githubusercontent.com`, `pipelines.actions.githubusercontent.com` | Hosts that must all resolve |
| `timeoutSeconds` | `120` | Seconds to wait before failing the job |

The runner downloads a job's actions before it runs the job-started hook, so an outage at that moment still fails "Set up job"; the hook protects checkout and every step after it. The timeout is checked between lookup rounds, so a lookup that hangs can extend the wait.

## How it works

Runner binaries are downloaded once per version into `.hydra/shared/github/<version>`. Each runner directory under `.hydra/runners/<id>` gets hardlinks for `bin`, a symlink for `externals`, and its own copies of the shell scripts, so ten runners cost roughly one copy of the runner distribution on disk. Start/stop is plain process management: a detached `bash run.sh` plus a pid file per runner.

Hydra disables the runner's automatic updater when registering it; use `hydra update` to update the shared binaries. Failed downloads are discarded, and completed registrations and removals are saved as each runner finishes, so a later failure in the batch can be retried. Failed deregistrations preserve the runner's files and record.
