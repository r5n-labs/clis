# Changelog

## 2026-03-07

**Packages**
- ✨ `@r5n/cli-core` 0.1.0 → 0.2.0
- ✨ `@r5n/sisyphus` 0.4.8 → 0.5.0

### 🪨 Rewrite from utility library to class-based CLI framework
**Packages:** `@r5n/cli-core`

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

### 🪨 Rewrite to class-based architecture with immutable domain model
**Packages:** `@r5n/sisyphus`

<details>
<summary>Description</summary>

  Complete rewrite from function-based commands to class-based OOP with domain-driven design.
  
  Key changes:
  - Commands: standalone functions → classes extending BaseCommand with typed context
  - Domain: plain types → immutable objects (Package, Stone, Commit) with static factories and withX() transformers
  - Storage: markdown table stones → JSON files
  - Services: scattered helpers → clear service classes (WorkspaceScanner, StoneManager, ChangelogGenerator, etc.)
</details>
