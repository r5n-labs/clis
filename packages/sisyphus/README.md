<p align="center">
  <img src="https://raw.githubusercontent.com/r5n-labs/clis/develop/packages/sisyphus/assets/logo.svg" width="128" alt="Sisyphus logo — a boulder resting on a slope">
</p>

# Sisyphus

**Small change records. One release.**

Record pending package changes as **stones**: reviewable JSON files in `.sisyphus/stones/`. Roll them together to bump versions, write changelogs and create a release commit. Enable tags, pushes, npm publication and provider releases when you need them.

[![npm](https://img.shields.io/npm/v/@r5n/sisyphus.svg)](https://www.npmjs.com/package/@r5n/sisyphus) [![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Runs on [Bun](https://bun.sh). The command is `sisyphus`, or `sis` for short. Packages are discovered from your root `package.json` workspaces.

## Quick start

```sh
bun add -g @r5n/sisyphus
sis init
sis version
sis check
sis roll
```

`init` creates the configuration. `version` prompts for package bumps and a message, then saves a stone. `check` previews the release. `roll` applies the pending stones and creates a release commit.

**Publishing is opt-in.** By default, `roll` updates local files and creates the commit. Review the [release options](https://github.com/r5n-labs/clis/blob/develop/packages/sisyphus/docs/commands.md#sisyphus-roll) before enabling external operations.

## Everyday commands

| Task | Command |
| --- | --- |
| Create a stone interactively | `sis version` |
| Preview stones from conventional commits | `sis version --fromCommits --dryRun` |
| Inspect pending changes | `sis check` |
| Edit or combine stones | `sis stone` |
| Preview a release | `sis roll --dryRun` |
| Resume an interrupted release | `sis roll --resume` |
| Create a stone from a pull request | `sis pr -u <url>` |
| Install CI workflows | `sis actions init` |

Use `sis -i` for the interactive menu and `sis <command> --help` for options. Sisyphus follows workspace dependencies, supports prerelease channels and keeps a durable ledger so interrupted external operations can be reconciled before resuming.

## Guides

| Guide | Covers |
| --- | --- |
| [Command reference](https://github.com/r5n-labs/clis/blob/develop/packages/sisyphus/docs/commands.md) | Versioning, releases, stones, pull requests, migration and CI commands |
| [Configuration and release model](https://github.com/r5n-labs/clis/blob/develop/packages/sisyphus/docs/configuration.md) | Config fields, stone format, dependency propagation, prereleases and builds |
| [GitHub Actions](https://github.com/r5n-labs/clis/blob/develop/packages/sisyphus/docs/github-actions.md) | Push-based releases, trusted publishing and generated workflows |

Configuration has an [editor schema](https://github.com/r5n-labs/clis/blob/develop/packages/sisyphus/schema.json).

## Requirements

- Bun and Git; a root `workspaces` field unless using `single` mode.
- Authenticated `gh` for GitHub pull requests and releases. GitLab operations use `GITLAB_TOKEN` or `glab`.

## Licence

[Apache 2.0](LICENSE).
