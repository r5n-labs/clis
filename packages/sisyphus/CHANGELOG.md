# @r5n/sisyphus

## ✨ 0.5.0 (2026-03-07)

### 🪨 Rewrite to class-based architecture with immutable domain model

<details>
<summary>Description</summary>

  Complete rewrite from function-based commands to class-based OOP with domain-driven design.
  
  Key changes:
  - Commands: standalone functions → classes extending BaseCommand with typed context
  - Domain: plain types → immutable objects (Package, Stone, Commit) with static factories and withX() transformers
  - Storage: markdown table stones → JSON files
  - Services: scattered helpers → clear service classes (WorkspaceScanner, StoneManager, ChangelogGenerator, etc.)
</details>

### Dependency updates
- `@r5n/cli-core` 0.1.0 → 0.2.0
