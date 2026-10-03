<p align="center">
  <img src="https://raw.githubusercontent.com/r5n-labs/clis/develop/packages/hydra/assets/logo.svg" width="128" alt="Hydra logo — three serpent heads">
</p>

# Hydra

**One machine. Many runners.**

Create and manage local self-hosted GitHub Actions runners for a repository or organisation. Hydra downloads each runner version once, shares its binaries across the fleet and registers runners through your authenticated `gh` CLI.

[![npm version](https://img.shields.io/npm/v/@r5n/hydra.svg)](https://www.npmjs.com/package/@r5n/hydra) [![License](https://img.shields.io/npm/l/@r5n/hydra.svg)](./LICENSE)

Each working directory has its own fleet, with profiles and runner state in `.hydra/`.

## Quick start

```sh
bun add -g @r5n/hydra
mkdir ~/runners
cd ~/runners
hydra init https://github.com/owner/repo -c 2
hydra create
hydra start
hydra status
```

`hydra -i` opens the interactive menu. Bare `hydra` prints help; `hydra <command> --help` shows that command's options.

## Everyday commands

| Task | Command |
| --- | --- |
| Configure a repository or organisation | `hydra init [url]` |
| Create runners up to the target count | `hydra create [profile] [count]` |
| Start or stop runners | `hydra start [profile] [ids...]` / `hydra stop [profile] [ids...]` |
| Inspect local runner state | `hydra status` |
| Tail the latest job log | `hydra logs [id]` |
| Preview disk cleanup | `hydra cleanup --dry-run` |
| Update shared runner binaries | `hydra update` |
| Deregister and remove runners | `hydra remove [profile] [ids...]` |
| Manage fleet profiles | `hydra profile` |

Runners are background processes; start them again after a reboot. Cleanup preserves job workspaces by default, and automatic runner updates are disabled in favour of `hydra update`.

See the [command and configuration reference](https://github.com/r5n-labs/clis/blob/develop/packages/hydra/docs/reference.md) for flags, profiles, cleanup policy and storage details.

## Requirements

- Bun, `bash`, `curl` and `tar`.
- Authenticated `gh` (`gh auth login`). Repository runners require repository admin access; organisation runners require the `admin:org` scope. Hydra obtains registration and removal tokens through `gh api` without storing them.
- macOS on Apple Silicon or Linux on x64. Windows is not supported: registration and startup use the runner's Bash scripts.

## Licence

[Apache 2.0](LICENSE).
