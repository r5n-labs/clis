# @r5n/cli-core

## ✨ 0.2.0 (2026-03-07)

### 🪨 Rewrite from utility library to class-based CLI framework

<details>
<summary>Description</summary>

  Transformed from a utility library (colors, git helpers, error handling, fuzzy matching) into a full CLI framework.
  
  New abstractions:
  - AbstractCLI: command routing, dual-mode (direct + interactive), global args, error boundaries
  - AbstractCommand: typed args/positionals with inference, subcommand composition, lifecycle hooks
  - ConfigManager: typed JSON persistence with deep merge
  - Exit/Cancel error classes with built-in handling
  
  CLIs now extend the framework instead of wiring up their own dispatch.
</details>
