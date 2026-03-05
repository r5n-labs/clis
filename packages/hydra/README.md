# Hydra

<div align="center">

[![npm version](https://img.shields.io/npm/v/@r5n/hydra.svg)](https://www.npmjs.com/package/@r5n/hydra)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
![Bundle Size](https://img.shields.io/badge/bundle_size-~110KB-green.svg)

Manage GitHub Actions self-hosted runners.

</div>

## Quick Start

```bash
# Install
bun add -g @r5n/hydra

# Initialize config
hydra init

# Create runners
hydra create -t $TOKEN -u https://github.com/org/repo -m 3

# Check status
hydra status -t $TOKEN -u https://github.com/org/repo
```

## Why?

Setting up self-hosted runners manually is tedious. Hydra automates it:

- Create multiple runners in parallel
- Reusable profile configs
- Monitor runner status
- Cross-platform (macOS, Linux, Windows)

## Commands

### `hydra init`

Create a config file with profiles.

```bash
hydra init              # Interactive
hydra init --toml       # Use TOML format
```

### `hydra create`

Create and register new runners.

```bash
# Basic
hydra create -t TOKEN -u REPO_URL

# Multiple with labels
hydra create -t TOKEN -u REPO_URL -m 5 -l "docker,gpu"

# Using profile
hydra create -p production -t TOKEN
```

**Options:**
- `-t, --token` — GitHub PAT (required)
- `-u, --url` — Repo/org URL (required)
- `-m, --numberOfMachines` — Number of runners (default: 1)
- `-n, --name` — Runner name prefix
- `-l, --labels` — Comma-separated labels
- `-d, --directory` — Runners directory
- `-o, --os` — OS: osx, linux, windows
- `-p, --profile` — Use config profile

### `hydra run`

Start existing runners.

```bash
hydra run -t TOKEN -u REPO_URL -m 3
hydra run -p production -t TOKEN
```

### `hydra remove`

Remove runners and unregister from GitHub.

```bash
hydra remove -t TOKEN -u REPO_URL -m 3
hydra remove -p production -t TOKEN -f  # Force without unregistering
```

### `hydra status`

Check runner status.

```bash
hydra status -t TOKEN -u REPO_URL
hydra status -p production -t TOKEN --json
```

## Configuration

### Profiles

Save common configs in `hydra.json` or `hydra.toml`:

```json
{
  "profiles": {
    "production": {
      "url": "https://github.com/org/repo",
      "name": "prod-runner",
      "numberOfMachines": 3,
      "labels": "linux,docker",
      "directory": "/opt/runners",
      "os": "linux"
    },
    "dev": {
      "url": "https://github.com/org/dev-repo",
      "name": "dev-runner",
      "numberOfMachines": 2,
      "labels": "test"
    }
  },
  "defaultProfile": "production"
}
```

Then use with `-p`:

```bash
hydra create -p production -t $TOKEN
hydra status -p dev -t $TOKEN
```

### Environment Variables

- `GITHUB_PERSONAL_ACCESS_TOKEN` — Default token
- `HYDRA_CONFIG` — Config file path

## Token Permissions

- **Repository runners:** `repo` scope
- **Organization runners:** `admin:org` scope

Never commit tokens. Use environment variables or pass via `-t`.

## Examples

```bash
# Development setup
hydra create -p dev -t $TOKEN -m 2

# Production with specific labels
hydra create -p prod -t $TOKEN -l "deploy,production"

# Monitor all runners
hydra status -p prod -t $TOKEN --json | jq '.[] | select(.status == "offline")'

# Cleanup
hydra remove -p dev -t $TOKEN
```

## Troubleshooting

**Invalid token error:**
- Check token has `repo` or `admin:org` scope
- Verify token isn't expired

**Runner config failed:**
- Check network connectivity
- Verify GitHub URL format
- Ensure write permissions in runner directory

**Debug mode:**
```bash
DEBUG=* hydra create -t TOKEN -u URL
```

## License

Apache 2.0 — see [LICENSE](./LICENSE)
