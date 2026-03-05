# Sisyphus

<div align="center">

[![npm version](https://img.shields.io/npm/v/@r5n/sisyphus.svg)](https://www.npmjs.com/package/@r5n/sisyphus)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
![Bundle Size](https://img.shields.io/badge/bundle_size-~163KB-green.svg)

Monorepo versioning with changesets ("stones").

</div>

## Quick Start

```bash
# Install
bun add -g @r5n/sisyphus

# Initialize
sisyphus init

# Create a version "stone"
sisyphus version

# Release
sisyphus roll --npm --github
```

## Why Stones?

Traditional versioning forces immediate releases. Stones let you stack changes and release when ready:

```bash
# Monday: Bug fix
sisyphus version --bump patch --filter @org/auth

# Tuesday: New feature
sisyphus version --bump minor --filter @org/api

# Friday: Ship it
sisyphus check              # Review pending changes
sisyphus roll --npm --github # Release all at once
```

**Benefits:**
- Stack changes throughout the week
- Coordinate multi-package updates
- Review before releasing
- Git-friendly (stones are markdown files)

## Commands

### `sisyphus init`

Initialize config in your project.

```bash
sisyphus init                    # Interactive
sisyphus init --single           # Single package mode
sisyphus init --nonInteractive   # Skip prompts
```

### `sisyphus version`

Create a version stone (changeset).

```bash
# Interactive
sisyphus version

# Specify packages and bump
sisyphus version --bump minor --filter @org/core

# Snapshot/prerelease
sisyphus version --snapshot --tag dev
```

**Options:**
- `-b, --bump` — Bump type: major, minor, patch
- `-f, --filter` — Package name filter
- `-s, --snapshot` — Create snapshot version
- `-t, --tag` — Release tag (alpha, beta, rc, etc.)
- `-y, --yes` — Skip confirmation

### `sisyphus check`

Review pending stones.

```bash
sisyphus check
sisyphus check --json  # JSON output
```

Shows:
- Pending stones
- Package version changes
- Dependency updates
- Last release info

### `sisyphus roll`

Process stones and release.

```bash
# Full release
sisyphus roll --npm --github --changelog

# Dry run
sisyphus roll --dry-run

# Just changelogs
sisyphus roll --changelog
```

**Options:**
- `-n, --npm` — Publish to npm
- `-g, --github` — Create GitHub releases
- `-c, --changelog` — Generate changelogs
- `-t, --withTags` — Create git tags
- `-d, --dryRun` — Preview without changes
- `--npmToken` — NPM authentication token
- `--githubToken` — GitHub authentication token

### `sisyphus prerelease`

Manage prerelease versions.

```bash
# Create beta prerelease
sisyphus prerelease --type beta --bump minor

# Promote prereleases interactively
sisyphus prerelease --promote
```

**Promotion flow:**
- Alpha → Beta, RC, or Stable
- Beta → RC or Stable  
- RC → Stable

### `sisyphus stone`

Manage individual stones.

```bash
sisyphus stone list              # List all stones
sisyphus stone show <id>         # Show stone details
sisyphus stone delete <id>       # Remove a stone
sisyphus stone edit <id>         # Edit stone message
sisyphus stone merge             # Combine multiple stones
```

### `sisyphus graph`

Visualize package dependencies.

```bash
sisyphus graph                   # Show full graph
sisyphus graph --filter @org/core # Focus on package
sisyphus graph --json            # Export as JSON
```

## Configuration

Sisyphus uses `.sisyphus/config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/r5n-labs/clis/main/packages/sisyphus/schema.json",
  "tag": "latest",
  "ignore": ["*-internal"],
  "single": false,
  "commit": {
    "message": "chore(release): ${message}"
  },
  "release": {
    "github": true,
    "npm": true,
    "tags": true
  },
  "changelog": {
    "generate": true
  }
}
```

## Stone Format

Stones are stored in `.sisyphus/stones/` as markdown:

```markdown
### feat: add authentication

Added OAuth2 support.

---

|   minor   |        patch        |
| :-------: | :-----------------: |
| @org/auth | @org/core, @org/api |
```

## Project Structure

```
your-project/
├── .sisyphus/
│   ├── config.json
│   └── stones/
│       ├── feat-auth.md
│       └── fix-bug.md
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   └── CHANGELOG.md
│   └── auth/
│       ├── package.json
│       └── CHANGELOG.md
└── CHANGELOG.md
```

## Examples

### Monorepo Workflow

```bash
# Feature work
sisyphus version --bump minor --filter @app/core

# Bug fix
sisyphus version --bump patch --filter @app/auth

# Breaking change
sisyphus version --bump major --filter @app/api

# Release all
sisyphus check
sisyphus roll --npm --github --changelog
```

### Prerelease Flow

```bash
# Create beta
sisyphus prerelease --type beta --bump minor --filter @org/new-feature

# Release beta
sisyphus roll --npm

# Promote to stable
sisyphus prerelease --promote
```

### CI/CD Integration

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      
      - run: bun install
      
      - name: Check for stones
        id: check
        run: |
          if [ -d ".sisyphus/stones" ] && [ "$(ls -A .sisyphus/stones)" ]; then
            echo "has_stones=true" >> $GITHUB_OUTPUT
          fi
      
      - name: Release
        if: steps.check.outputs.has_stones == 'true'
        run: bunx @r5n/sisyphus roll --npm --github --changelog
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Security

### Token Management

- **NPM:** Requires `NPM_TOKEN` env var or `--npmToken`
- **GitHub:** Requires `GITHUB_TOKEN` env var or `--githubToken`
- Never store tokens in config files
- Use environment variables in CI/CD

### Best Practices

1. Review stones before rolling (`sisyphus check`)
2. Test with dry-run mode
3. Commit stones to version control
4. Use branch protection for releases

## Troubleshooting

**No stones found:**
- Create stones with `sisyphus version` first
- Check `.sisyphus/stones/` directory exists

**Package not found:**
- Verify package name
- Check if package is ignored in config

**Publish failed:**
- Verify NPM token permissions
- Check if version already exists
- Ensure package.json has required fields

**Debug mode:**
```bash
DEBUG=* sisyphus roll --dry-run
cat .sisyphus/config.json
ls -la .sisyphus/stones/
```

## License

Apache 2.0 — see [LICENSE](./LICENSE)
