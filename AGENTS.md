# R5N CLI Monorepo - Agent Guidelines

## Quick Reference

| Task | Command |
|------|---------|
| Build all | `bun run build` |
| Build single package | `bun --filter @r5n/sisyphus build` |
| Lint & format | `bun lint` |
| Type check (verbose) | `bun type-check:go` |
| Type check (CI) | `bun type-check:ci` |
| Run all tests | `bun test` |
| Run single test file | `bun test packages/path/to/file.test.ts` |
| Run tests by pattern | `bun test -t "pattern"` |
| Clean & reinstall | `bun clean` |

## Core Mandates

- **Runtime:** ALWAYS use `bun`. Never use `npm`, `yarn`, `pnpm`, or `bunx`.
- **Formatting:** Managed by Biome. Run `bun lint` before committing.
- **Validation:** Use `banditypes` (imported from `banditypes`), NOT Zod.
- **Architecture:** Zero-dependency bundled CLIs. `@r5n/cli-core` is shared.

## Project Structure

```
packages/
  core/           # @r5n/cli-core - Shared CLI framework
  sisyphus/       # @r5n/sisyphus - Version/publish tool
  atlas/          # @r5n/atlas - CLI tools
  hydra/          # @r5n/hydra - CLI tools
tools/            # @r5n/tools - Build utilities, shared configs
```

## Import Order (Biome-enforced)

```typescript
import fs from "node:fs";               // 1. Node built-ins (use node: prefix)
import { log } from "@clack/prompts";   // 2. External packages
import { AbstractCommand } from "@r5n/cli-core";  // 3. Workspace packages
import { colors } from "@r5n/tools/utils";
import { $ } from "bun";                // 4. Bun
import { BaseCommand } from "../base";  // 5. Relative imports
import type { Config } from "../types"; // 6. Type-only imports (at the end)
```

## Code Style

### Formatting (Biome-enforced)
- **Indent:** 2 spaces | **Line width:** 120 chars | **Semicolons:** Always
- **Line endings:** LF | **Quotes:** Double | **Bracket spacing:** Enabled

### TypeScript Strictness
- `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`
- `noUnusedLocals: true`, `noUnusedParameters: true`, `verbatimModuleSyntax: true`

### Naming Conventions
- **Variables/functions:** `camelCase` | **Classes/types/enums:** `PascalCase`
- **Constants:** `SCREAMING_SNAKE_CASE` | **Files:** `kebab-case.ts` or `PascalCase.ts`

### Comments & Return Types
- **No comments** unless explicitly requested - code should be self-documenting
- **Omit explicit return types** when inferrable; add them for public APIs

### Magic Numbers
Extract all magic numbers to named constants:
```typescript
const VERSION_INCREMENT = 1;
const DECIMAL_RADIX = 10;
```

## Error Handling

### Exit Class for User-facing Errors
```typescript
import { Exit } from "@r5n/cli-core";
throw new Exit("Package not found", "Run 'sisyphus init' first");
```

### Error Handling Pattern
```typescript
if (error instanceof Exit) {
  log.warn(color.yellow(error.message));
  if (error.hint) log.info(color.dim(error.hint));
  return;
}
```

### Async Rules
- **No floating promises** - Always `await` or handle (Biome enforces `noFloatingPromises`)

## Type Patterns

### Arg Definitions
```typescript
import { args } from "@r5n/cli-core";

const checkArgs = args({
  json: { alias: "j", default: false, description: "Output as JSON", type: "boolean" },
});
type CheckCtx = Ctx<typeof checkArgs>;
```

### Enums with Associated Data
```typescript
export enum BumpType { Major = "major", Minor = "minor" }

export const BUMP_EMOJI: Record<BumpType, string> = {
  [BumpType.Major]: "...",
  [BumpType.Minor]: "...",
};
```

### Type Guards
```typescript
export function isBumpType(value: string): value is BumpType {
  return Object.values(BumpType).includes(value as BumpType);
}
```

## Class Patterns

### Command Classes
```typescript
export abstract class BaseCommand extends AbstractCommand<SisyphusConfig> {}

export class CheckCommand extends BaseCommand {
  name = "check";
  description = "Show workspace packages";
  args = checkArgs;
  async execute(ctx: CheckCtx) { /* ... */ }
}
```

### Static Utility Classes
```typescript
export class VersionCalculator {
  static bump(version: string, bump: BumpType): string { /* ... */ }
  private static formatSnapshot(tag?: string): string { /* ... */ }
}
```

## Exports

Barrel exports in `index.ts`:
```typescript
export * from "./BumpType";
export * from "./Package";
```

Mixed exports (star + named):
```typescript
export * from "./src/abstract-cli";
export { AbstractCommand, args, type ArgDefinition } from "./src/abstract-command";
```

## Git Hooks

Pre-commit runs Biome on staged files (lefthook):
```yaml
pre-commit:
  commands:
    lint:
      glob: "*.{jsx,tsx,ts,js,json}"
      run: bun biome check --write {staged_files}
```
