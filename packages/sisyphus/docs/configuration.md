# Configuration and release model

[Sisyphus](../README.md) / Configuration and release model

## Configuration

`.sisyphus/config.json`, created by `init` (trimmed excerpt — `init` writes the full default set, including an extended `pr.labelMapping` and commit-skip patterns):

```json
{
  "$schema": "https://raw.githubusercontent.com/r5n-labs/clis/refs/heads/develop/packages/sisyphus/schema.json",
  "single": false,
  "tag": "latest",
  "commit": {
    "author": "r5n-bot",
    "email": "r5n-bot@users.noreply.github.com",
    "message": "chore(release): {message}"
  },
  "changelog": {
    "generate": true,
    "root": false,
    "append": true,
    "filename": "CHANGELOG.md",
    "packageHeader": "{emoji} {version} ({date})",
    "rootHeader": "{date} - {packages}"
  },
  "release": {
    "npm": false,
    "npmVisibilityTimeout": 0,
    "tags": false,
    "push": false,
    "createRelease": false
  },
  "commits": {
    "skip": {
      "authors": ["r5n-bot[bot]"],
      "messagePatterns": ["^chore\\(release\\):"]
    }
  },
  "pr": {
    "labelMapping": { "breaking": "major", "feature": "minor", "fix": "patch" },
    "skip": {
      "labels": ["sisyphus-release", "skip-stone"],
      "authors": ["r5n-bot[bot]"],
      "titlePatterns": ["^chore\\(release\\):"]
    }
  }
}
```

- `single` — version the root package instead of workspace packages
- `tag` — npm dist-tag used when publishing
- `commit` — release commit author/email and message template; `{message}` and `{packages}` are substituted; a valid `email` is required whenever `author` is set
- `changelog` — `sections` maps conventional commit types (`feat`, `fix`, `breaking`, ...) to headings; `root` adds a combined root changelog; `packageHeader`/`rootHeader` support `{emoji}`, `{version}`, `{date}`, `{packages}`
- `commits.skip` / `pr.skip` — filters for `version --fromCommits` and `pr`
- `release` — defaults for the corresponding `roll` flags, plus `release.build` (see below)
- `release.npmVisibilityTimeout` — seconds to wait after npm publication for each released version to appear on its registry with the integrity of the packed artifact. npm can take minutes, occasionally much longer, to list a new version, so versions still missing after the timeout become report warnings rather than a failed release. `0` (the default) skips the check
- `dependents` — which manifest sections pull a dependent into a release (`kinds`) and whether dependents are always released or only when their published range no longer admits the new version (`updateInternal`)
- `ignore` — package names or globs that are never released; they are skipped when selecting packages, never pulled in as dependents, and never traversed through
- `sisyphusDir` / `stonesPath` — relocate the config directory or stone storage
- `lastStone`, `stones`, `currentRelease` — managed by the CLI; don't edit by hand

## Stones

Each stone is a JSON file at `.sisyphus/stones/<id>.json`, safe to commit and review:

```json
{
  "id": "0001-741d2bed",
  "message": "feat: add auth",
  "description": "Optional longer notes",
  "minor": ["@org/auth"],
  "patch": ["@org/api"],
  "dependency": ["@org/app"]
}
```

Stones may also carry a `tag` (prerelease) and the `commits` they were generated from. `roll` merges every pending stone, keeping the highest bump per package. Every pending stone must agree on the prerelease tag, and a package cannot be both a snapshot and a normal release in one roll.

## Dependents

Selecting a package pulls in everything that depends on it, transitively, as a `dependency` bump. Propagation follows only `workspace:` protocol specifiers — a dependency declared with a plain version range is never treated as an internal edge, even when its name matches a workspace package. Edges come from the manifest sections listed in `dependents.kinds`; the default includes `devDependencies` because bundled packages inline their workspace dependencies at build time. Drop it when only the published manifest matters:

```json
{
  "dependents": {
    "kinds": ["dependencies", "optionalDependencies", "peerDependencies"],
    "updateInternal": "always"
  }
}
```

`updateInternal: "outOfRange"` releases a dependent only when its published range would no longer admit the new version — `workspace:*` is always invalidated, `workspace:^` survives a minor bump above 0.x, `workspace:~` survives a patch, and a literal `workspace:<range>` is never rewritten so it never triggers a release. Releases are ordered so a dependency is tagged and published before the dependent that pins it. Publication order follows runtime, optional and peer dependencies; development dependencies are removed from the published manifest and do not constrain that order.

When an untagged release graduates a prerelease package, selected prerelease dependents connected through the sections in `dependents.kinds` graduate with it. Excluded sections cannot cause a dependent to leave its prerelease channel.

## Prereleases

Pass `--tag` to `version` to open a prerelease channel. The base version is bumped first, so the prerelease always sorts above the last stable release:

| current | stone | result |
| --- | --- | --- |
| `1.0.0` | minor + `--tag beta` | `1.1.0-beta.0` |
| `1.1.0-beta.0` | patch + `--tag beta` | `1.1.0-beta.1` |
| `1.1.0-beta.1` | major + `--tag beta` | `2.0.0-beta.0` |
| `1.1.0-beta.1` | patch, no tag | `1.1.0` |

Omitting `--tag` leaves the channel and lands on the accumulated stable target. The npm dist-tag follows the channel, so prereleases never publish as `latest`. A single roll cannot publish stable and prerelease packages to npm together — the dist-tag applies to the whole release — so such a mix fails closed before anything is published. In practice, graduate the prerelease packages first or roll the two channels separately.

## Build

`roll` builds each package before packing it. By default that is `bun run build` in the package directory:

```json
{
  "release": {
    "build": {
      "command": ["bun", "run", "build"],
      "root": [["bun", "run", "build:dts"]],
      "outputs": ["packages/*/dist/**"]
    }
  }
}
```

`root` runs once at the repository root before the first package is packed — for declarations or bundles generated centrally. `command: []` disables the per-package build. `outputs` declares the gitignored paths the build writes: they are removed before the build and exempted from the guards that otherwise reject untracked and ignored files, while everything else stays rejected. A declared output that Git tracks is refused before any build runs. Commands are executed directly, never through a shell.
