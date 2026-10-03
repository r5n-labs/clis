<p align="center">
  <img src="https://raw.githubusercontent.com/r5n-labs/clis/develop/packages/atlas/assets/logo.svg" width="128" alt="Atlas logo — a globe held aloft">
</p>

# Atlas

**Build an environment from the pieces you need.**

Combine named profiles for a team, application, environment or machine. Atlas resolves their dotenv files, literal values and secret references, then runs a command with that environment or exports a dotenv file.

**Private and unreleased.** Run it from this monorepo with Bun.

## Quick start

From the repository root:

```sh
bun atlas init
```

Define profiles in the generated `.atlas/config.json`:

```json
{
  "defaults": { "profiles": ["team"], "exportFile": ".env.generated" },
  "profiles": {
    "team": { "vars": { "ORG": "r5n" } },
    "env:dev": {
      "vars": { "NODE_ENV": "development" }
    }
  }
}
```

Run a command or export the resolved environment:

```sh
bun atlas run --profile env:dev -- bun --version
bun atlas export --profile env:dev
```

Put child-command flags after `--`. The export uses `.env.generated` from the defaults; add `--out <path>` to choose another file.

## Everyday commands

| Task | Command |
| --- | --- |
| Initialise project or global config | `bun atlas init [--global]` |
| List available profiles | `bun atlas profiles list` |
| Inspect a profile | `bun atlas profiles show <profile>` |
| Combine profiles for a process | `bun atlas run --profile app:web,env:dev -- <command...>` |
| Export a dotenv file | `bun atlas export --profile app:web,env:dev --out <path>` |
| Print dotenv to stdout | `bun atlas export --profile env:dev --stdout` |

## How profiles combine

Atlas merges global `~/.atlas/config.json` with the nearest project `.atlas/config.json`. Profiles can extend parents, read dotenv files, set non-secret values and resolve secrets from environment variables or files. Project profiles override global profiles of the same name.

The [configuration reference](docs/reference.md) explains precedence, inheritance, secret references, dotenv parsing and export limits. Atlas preserves literal `$` references rather than expanding them.

Project configuration is applied automatically, and secret file references may point outside the project. Review a repository's `.atlas/config.json` before using Atlas inside it.

## Licence

[Apache 2.0](LICENSE).
