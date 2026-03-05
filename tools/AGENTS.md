# AGENTS.md - R5N Tools Repository

## Essential Commands
```bash
bun lint                    # Run Biome linting/formatting with auto-fix
bun setup-monorepo          # Set up a new monorepo with default config
bun test                    # No test command configured (add tests as needed)
```

## Code Style Guidelines
- **Runtime**: Always use `bun` instead of npm/yarn/pnpm
- **Imports**: Use ESM imports with `.ts` extensions allowed, organize imports alphabetically
- **Formatting**: 2 spaces, 100 char line width, semicolons always, LF line endings
- **TypeScript**: Strict mode enabled, ESNext target, no implicit any, use const assertions
- **Naming**: Use camelCase for variables/functions, PascalCase for types/classes/enums
- **Error Handling**: Always handle errors explicitly, use AggregateError for multiple errors
- **Logging**: Use `createLogger({ prefix: "name" })` pattern from utils/logger.ts
- **Exports**: Prefer named exports, barrel exports allowed from index files
- **Promises**: No floating promises, always await or handle async operations
- **Types**: Avoid inferrable types, use explicit return types for public APIs
- **Comments**: Minimal comments, code should be self-documenting

## Project Structure
- `/builder/` - Build utilities using Bun.build API
- `/scripts/` - Automation scripts for monorepo setup
- `/utils/` - Shared utilities (colors, logger) exported from index.ts
- `/typescript/` - Shared TypeScript configuration (strict, ESNext, Bun support)