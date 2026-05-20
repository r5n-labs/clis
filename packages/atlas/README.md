# Atlas

Profile-based env composition for apps and environments.

Atlas is a small dotenv-style CLI for projects that need more than one `.env` file. It combines named profiles such as `team`, `app:web`, `env:dev`, or `machine:runner`, then either runs a command with the resolved env or exports a dotenv file.

## Quick Start

```bash
bun add -g @r5n/atlas

atlas init
```

Create `.atlas/config.json`:

```json
{
  "defaults": { "profiles": ["team", "app:web"], "exportFile": ".env.generated" },
  "profiles": {
    "team": {
      "vars": { "ORG": "r5n" }
    },
    "app:web": {
      "envFiles": [".env.shared"],
      "vars": { "APP": "web" }
    },
    "env:dev": {
      "vars": { "NODE_ENV": "development" },
      "secrets": {
        "API_TOKEN": { "env": "WEB_API_TOKEN" }
      }
    }
  }
}
```

Run a command:

```bash
atlas run --profile env:dev -- bun dev
```

Export a dotenv file:

```bash
atlas export --profile env:dev
atlas export --profile app:web,env:prod --out .env.production --force
```

## Config Model

Atlas reads two optional config layers:

- `~/.atlas/config.json` for global defaults and shared profiles
- the nearest `.atlas/config.json` from the current directory upward for project profiles

Project defaults override global scalar defaults, project profiles override global profiles with the same name, and default profile lists are appended in global-then-project order.

Profiles can contain:

- `extends` — parent profiles applied first
- `envFiles` — dotenv files relative to the config root
- `vars` — literal non-secret values
- `secrets` — runtime references to process env vars or local files

Secrets are references, not stored secret values:

```json
{
  "profiles": {
    "env:prod": {
      "secrets": {
        "DATABASE_URL": { "env": "PROD_DATABASE_URL" },
        "PRIVATE_KEY": { "file": ".secrets/private-key.pem", "trim": false }
      }
    }
  }
}
```

## Commands

```bash
atlas init [--global] [--force]
atlas profiles list
atlas profiles show <profile>
atlas run --profile app:web,env:dev -- <command...>
atlas export --profile app:web,env:dev [--out .env] [--stdout] [--force]
```

## License

Apache 2.0 — see [LICENSE](./LICENSE)
