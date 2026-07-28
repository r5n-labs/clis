# @r5n/cli-core

Shared framework behind every R5N CLI. Internal package — not published; consumed via `workspace:*` and bundled into each CLI at build time.

## What it provides

- **`AbstractCLI`** — entry point: command registration, global flags (`--help`, `--version`, `--interactive`), routing, error handling. Bare invocation prints help; `-i` opens an interactive menu; `help [command]` works as a command.
- **`AbstractCommand`** + **`CommandRouter`** — class-based commands with nested subcommands, direct and interactive execution.
- **`args()`** / **`positionals()`** — typed argument definitions (mri under the hood) with generated help.
- **`Exit`** / **`Cancel`** — typed user-facing failures: `throw new Exit(message, hint?, exitCode?)` renders a warning plus hint instead of a stack trace, then terminates with `exitCode` (defaults to `1`). Error causes are rendered too: any `cause` chain or `AggregateError` members surface as dimmed `caused by:` lines (nested up to 4 levels, each nested `Exit`'s hint included), for both `Exit` and plain `Error` failures, in direct commands and the interactive menu alike. `Cancel` (thrown when a prompt is dismissed) unwinds to the previous menu, or exits cleanly with code `0`.
- **`prompts`** — thin wrappers over [@clack/prompts](https://github.com/bombshell-dev/clack) (`select`, `multiselect`, `confirm`, `text`) with consistent keyboard-hint styling and cancel handling, plus re-exports (`log`, `note`, `spinner`, …).
- **`ConfigManager`** — JSON config persistence with deep-merge defaults.
- **Utilities** — `color`, help formatting, Levenshtein "did you mean" suggestions.

## Usage

```ts
import { AbstractCLI, AbstractCommand, args, ConfigManager, Exit } from "@r5n/cli-core";
```

See `packages/hydra/src/cli.ts` for a complete, current example of wiring a CLI together.
