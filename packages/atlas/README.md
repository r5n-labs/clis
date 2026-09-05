# Atlas

Profile-based env composition for apps and environments.

Atlas is a small dotenv-style CLI for projects that need more than one `.env` file. It combines named profiles such as `team`, `app:web`, `env:dev`, or `machine:runner`, then either runs a command with the resolved env or exports a dotenv file.

**Not released yet.** The implementation is available from this monorepo while the package remains private.

## Quick Start

```bash
bun atlas init
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

Flags meant for the child command must come after `--`; `atlas run` rejects flags it does not recognise.

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

Each secret reference must define exactly one of `env` or `file`. The `trim` option applies only to file references; file contents are trimmed by default.

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

## Dotenv Parsing

Atlas reads `envFiles` with its own parser rather than Bun's `--env-file` loader. Both accept `export ` prefixes, `#` comment lines, unquoted values, and `"`, `'`, or `` ` `` quoted values that continue across lines until their closing quote, so a single-quoted PEM block stays intact in either reader. The Atlas parser then diverges from Bun deliberately:

- **No variable expansion.** Bun expands `$VAR`, `${VAR}`, and `${VAR:-default}` in every value — including single-quoted and backtick values — from the file and the parent process env. Atlas passes values through literally, so `PASSWORD='p$ssw0rd'` keeps its `$`. Both readers decode `\$` to a literal `$`.
- **A wider double-quoted escape set.** Atlas decodes `\n`, `\r`, `\t`, `\"`, `\\`, and `\$` inside double quotes; Bun decodes only `\n`, `\r`, and `\$` and leaves the rest as literal backslash sequences. Single-quoted and backtick values keep every backslash literal in both readers.
- **Stricter inline comments.** A `#` only starts a comment when it follows whitespace or a closing quote, so `TOKEN=abc#fragment` keeps its fragment. Bun cuts that value at the `#`.

A closing quote — single-line or multiline — may only be followed by whitespace or a comment, matching Bun 1.3.14. `A='first` / `second' trailing` is therefore not a multiline value in either reader: Bun keeps `A` as the literal `'first` and skips the second line, while Atlas keeps the same `A` and then rejects `second' trailing` as a line that is not `KEY=VALUE`.

A line that is neither blank, a comment, nor `KEY=VALUE` is an error rather than a skipped line. The message names the env file and the line number but never the line's contents.

## Trust Model

Atlas discovers the nearest project `.atlas/config.json` upward from the current directory and applies it without confirmation. Secret `file` references can read arbitrary paths, so review a repository's `.atlas/config.json` before running `atlas` inside it. A trust prompt for newly discovered project configs is a planned follow-up.

`atlas export` refuses values that cannot round-trip through both Atlas and Bun's dotenv grammar (for example values mixing quotes with `#`, or ending in unbalanced backslash or `\$` sequences) instead of writing a file that would parse back differently. A value holding both a newline and a double quote — `line one` then `say "hello"` — is one such case: the newline forces the double-quoted form, where the embedded `"` would end the value early, so the export fails with `Unrepresentable dotenv value for key <KEY>`.

## Commands

```bash
atlas init [--global] [--force]
atlas profiles list [--json] [--cwd <dir>]
atlas profiles show <profile> [--json] [--cwd <dir>]
atlas run --profile app:web,env:dev -- <command...>
atlas export --profile app:web,env:dev [--out .env] [--force]
atlas export --profile app:web,env:dev --stdout
```

With `--json`, profile commands write results to stdout. Configuration and profile lookup errors produce a single `{"error": "..."}` object on stderr and a non-zero exit code.

`--stdout` prints the dotenv body instead of writing a file, so it cannot be combined with `--out`.

## License

Apache 2.0 — see [LICENSE](./LICENSE)
