import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const PREFIX = "[setup-monorepo]";
const log = (...args: unknown[]) => console.log(PREFIX, ...args);
const logError = (...args: unknown[]) => console.error(PREFIX, ...args);

const BIOME_CONTENT = `{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "extends": ["./tools/biome.json"]
}
`;

const BUNFIG_CONTENT = `[install]
# Save exact dependency versions without ranges
exact = true
`;

const CI_WORKFLOW_CONTENT = `name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  lint-and-type-check:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          ref: \${{ github.head_ref }}
          submodules: recursive

      - name: Setup bun & install dependencies
        uses: ./tools/github/setup

      - name: Run linter
        run: bun lint:ci

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          ref: \${{ github.head_ref }}
          submodules: recursive

      - name: Setup bun & install dependencies
        uses: ./tools/github/setup

      - name: Run tests
        run: bun test
`;

const GITIGNORE_CONTENT = `# Dependencies
node_modules/

# Build outputs
dist/
build/
out/

# Logs
*.log

# Environment variables
*.env
!.env.example

# OS
.DS_Store
Thumbs.db

# IDE
.idea/
*.swp
*.swo

# Testing
coverage/

# Temporary files
.tmp/
*.tmp
`;

const LEFTHOOK_CONTENT = `pre-commit:
  parallel: true
  commands:
    biome:
      glob: "*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc,css,scss}"
      run: bun lint --no-errors-on-unmatched --files-ignore-unknown=true --colors=off {staged_files}
      stage_fixed: true

    typecheck:
      glob: "*.{ts,tsx}"
      run: bun type-check
      fail_text: "TypeScript errors found. Fix them before committing."

skip_output:
  - meta
  - summary
`;

const VSCODE_SETTINGS_CONTENT = `{
  "editor.codeActionsOnSave": {
    "quickfix.biome": "explicit",
    "source.fixAll.biome": "explicit",
    "source.organizeImports.biome": "explicit",
    "source.removeUnusedImports": "explicit"
  },
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "typescript.tsdk": "node_modules/typescript/lib"
}
`;

const cwd = process.cwd();
const isInToolsDir = basename(cwd) === "tools";
const monorepoRoot = join(cwd, isInToolsDir ? ".." : "");
const packageJsonPath = join(monorepoRoot, "package.json");
const configFiles = {
  biome: { content: BIOME_CONTENT, path: join(monorepoRoot, "biome.json") },
  bunfig: { content: BUNFIG_CONTENT, path: join(monorepoRoot, "bunfig.toml") },
  ci: { content: CI_WORKFLOW_CONTENT, path: join(monorepoRoot, ".github/workflows/ci.yml") },
  gitignore: { content: GITIGNORE_CONTENT, path: join(monorepoRoot, ".gitignore") },
  lefthook: { content: LEFTHOOK_CONTENT, path: join(monorepoRoot, "lefthook.yml") },
  vscode: { content: VSCODE_SETTINGS_CONTENT, path: join(monorepoRoot, ".vscode/settings.json") },
};

async function setupConfigFiles() {
  for (const [key, { content, path }] of Object.entries(configFiles)) {
    const file = Bun.file(path);
    const exists = await file.exists();

    if (exists) {
      log(`${key} already exists`);
      continue;
    }

    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, content);
    log(`✅ Created ${path}`);
  }
}

async function readOrCreatePackageJson() {
  const packageJsonFile = Bun.file(packageJsonPath);
  const exists = await packageJsonFile.exists();

  if (exists) {
    log("Found existing package.json");
    return await packageJsonFile.json();
  }

  const folderName = basename(monorepoRoot) || "monorepo";
  log("Creating new package.json");

  return {
    license: "Apache-2.0",
    name: `@${folderName}/monorepo`,
    packageManager: `bun@${Bun.version}`,
    private: true,
    version: "0.0.0",
  };
}

function mergeArrayField(existing: string[] | undefined, additions: string[]): string[] {
  if (!existing) return additions;

  const merged = new Set(existing);
  for (const item of additions) {
    merged.add(item);
  }
  return Array.from(merged);
}

async function runSetupCommands() {
  const devDependencies = ["@biomejs/biome", "lefthook", "typescript"];
  const commands = {
    install: {
      command: `bun add -d ${devDependencies.join(" ")}`,
      description: "Install dependencies and development tools",
    },
    lint: { command: "bun biome check --write --unsafe", description: "Run linting with --unsafe for initial setup" },
    typecheck: { command: "bun type-check", description: "Run type-checking for initial setup" },
  };

  for (const [key, { command, description }] of Object.entries(commands)) {
    try {
      log(`Running ${key}: ${description}`);
      await Bun.$`${{ raw: command }}`.cwd(monorepoRoot);
      log(`✅ ${key} completed`);
    } catch (cause) {
      throw new Error(`${key} failed: ${description}`, { cause });
    }
  }
}

async function main() {
  const packageJson = await readOrCreatePackageJson();
  const trustedDependencies = ["@biomejs/biome", "lefthook"];
  const workspaces = ["packages/*", "tools"];
  const scripts = {
    bootstrap: "bun install",
    clean: "rm -rf node_modules build && bun install --frozen-lockfile",
    lint: "bun biome check --write",
    "lint:ci": "bun biome check",
    postinstall: "bun lefthook install",
    test: "bun test",
    "type-check": "bun --elide-lines=0 --filter '*' type-check",
  };

  const updatedPackageJson = {
    ...packageJson,
    scripts: { ...scripts, ...packageJson.scripts },
    trustedDependencies: mergeArrayField(packageJson.trustedDependencies, trustedDependencies),
    workspaces:
      Array.isArray(packageJson.workspaces) || !packageJson.workspaces
        ? mergeArrayField(packageJson.workspaces, workspaces)
        : { ...packageJson.workspaces, packages: mergeArrayField(packageJson.workspaces.packages, workspaces) },
  };

  await Bun.write(packageJsonPath, `${JSON.stringify(updatedPackageJson, null, 2)}\n`);
  log("✅ package.json updated successfully!");

  await setupConfigFiles();
  await runSetupCommands();
  log("✅ Monorepo setup completed");
}

main().catch((err) => {
  logError("Failed to setup monorepo:", err);
  process.exit(1);
});
