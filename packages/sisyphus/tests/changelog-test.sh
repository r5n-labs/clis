#!/bin/bash
#
# E2E test for changelog generation.
# Creates a temporary monorepo, makes commits, and verifies changelogs.
# Run: ./tests/changelog-test.sh
#
set -e

export PATH="$HOME/.bun/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIS="bun --bun $SCRIPT_DIR/../src/cli.ts"
DIR="/tmp/sis-test-big"

echo "=== Changelog E2E Test ==="
echo ""

rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"

git init
git remote add origin git@github.com:acme-corp/mega-monorepo.git

# Create root package and directories
mkdir -p packages/core packages/utils packages/cli packages/web
mkdir -p packages/logger packages/server packages/config packages/api packages/dashboard

npm init -y
npm pkg set private=true
npm pkg set workspaces[]="packages/*"

# Initialize all packages using npm
cd packages/core && npm init -y && cd ../..
cd packages/utils && npm init -y && cd ../..
cd packages/cli && npm init -y && cd ../..
cd packages/web && npm init -y && cd ../..
cd packages/logger && npm init -y && cd ../..
cd packages/server && npm init -y && cd ../..
cd packages/config && npm init -y && cd ../..
cd packages/api && npm init -y && cd ../..
cd packages/dashboard && npm init -y && cd ../..

# Set package names, versions, and dependencies
cd packages/core && npm pkg set name="@acme/core" version="1.0.0" && cd ../..
cd packages/utils && npm pkg set name="@acme/utils" version="2.0.0" dependencies.@acme/core="workspace:*" && cd ../..
cd packages/cli && npm pkg set name="@acme/cli" version="0.5.0" dependencies.@acme/core="workspace:*" dependencies.@acme/utils="workspace:*" && cd ../..
cd packages/web && npm pkg set name="@acme/web" version="3.0.0" dependencies.@acme/core="workspace:*" dependencies.@acme/utils="workspace:*" && cd ../..
cd packages/logger && npm pkg set name="@acme/logger" version="1.2.0" dependencies.@acme/core="workspace:*" && cd ../..
cd packages/server && npm pkg set name="@acme/server" version="4.0.0" dependencies.@acme/core="workspace:*" dependencies.@acme/logger="workspace:*" && cd ../..
cd packages/config && npm pkg set name="@acme/config" version="1.0.0" dependencies.@acme/core="workspace:*" && cd ../..
cd packages/api && npm pkg set name="@acme/api" version="2.5.0" dependencies.@acme/core="workspace:*" dependencies.@acme/config="workspace:*" && cd ../..
cd packages/dashboard && npm pkg set name="@acme/dashboard" version="1.0.0" dependencies.@acme/core="workspace:*" dependencies.@acme/config="workspace:*" dependencies.@acme/api="workspace:*" && cd ../..

git add .
git commit -m "chore: initial monorepo setup"

echo ""
echo ">>> Creating conventional commits..."
echo ""

# Core commits
printf 'export function createId() { return Math.random().toString(36); }\n' > packages/core/id.ts
git add . && git commit -m "feat(core): add ID generation utility"

printf 'export function validate(data: unknown) { return !!data; }\n' > packages/core/validate.ts
git add . && git commit -m "feat(core): add validation helpers"

printf 'export class CoreError extends Error { code: string; }\n' > packages/core/error.ts
git add . && git commit -m "feat(core): add custom error class"

# Utils commits
printf 'export function debounce(fn: Function, ms: number) { /* impl */ }\n' > packages/utils/debounce.ts
git add . && git commit -m "feat(utils): add debounce utility"

printf 'export function throttle(fn: Function, ms: number) { /* impl */ }\n' > packages/utils/throttle.ts
git add . && git commit -m "feat(utils): add throttle utility"

# Logger commits
printf 'export const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };\n' > packages/logger/levels.ts
git add . && git commit -m "feat(logger): add log level constants"

printf 'export function formatMessage(level: string, msg: string) { return `[${level}] ${msg}`; }\n' > packages/logger/format.ts
git add . && git commit -m "fix(logger): improve message formatting"

# Config commits
printf 'export function loadConfig(path: string) { /* impl */ }\n' > packages/config/loader.ts
git add . && git commit -m "feat(config): add config file loader"

printf 'export function mergeConfigs(...configs: object[]) { return Object.assign({}, ...configs); }\n' > packages/config/merge.ts
git add . && git commit -m "feat(config): add config merging"

# CLI commits
printf 'export function parseArgs(args: string[]) { /* impl */ }\n' > packages/cli/parser.ts
git add . && git commit -m "feat(cli): add argument parser"

printf 'export function showHelp() { console.log("Usage: ..."); }\n' > packages/cli/help.ts
git add . && git commit -m "docs(cli): add help command"

# Web commits
printf 'export function renderComponent(name: string) { /* impl */ }\n' > packages/web/render.ts
git add . && git commit -m "feat(web): add component renderer"

printf 'export function hydrate(el: HTMLElement) { /* impl */ }\n' > packages/web/hydrate.ts
git add . && git commit -m "fix(web): fix hydration edge case"

# Server commits
printf 'export function createServer(port: number) { /* impl */ }\n' > packages/server/create.ts
git add . && git commit -m "feat(server): add server factory"

printf 'export function middleware(req: any, res: any, next: any) { next(); }\n' > packages/server/middleware.ts
git add . && git commit -m "feat(server): add middleware support"

# API commits
printf 'export function defineRoute(path: string, handler: Function) { /* impl */ }\n' > packages/api/routes.ts
git add . && git commit -m "feat(api): add route definition helpers"

printf 'export function validateRequest(schema: object, data: unknown) { /* impl */ }\n' > packages/api/validation.ts
git add . && git commit -m "fix(api): improve request validation"

# Dashboard commits
printf 'export function createChart(data: number[]) { /* impl */ }\n' > packages/dashboard/chart.ts
git add . && git commit -m "feat(dashboard): add chart component"

printf 'export function createTable(rows: object[]) { /* impl */ }\n' > packages/dashboard/table.ts
git add . && git commit -m "feat(dashboard): add table component"

printf 'export function exportToPdf(element: HTMLElement) { /* impl */ }\n' > packages/dashboard/export.ts
git add . && git commit -m "feat(dashboard): add PDF export"

# Breaking change with body
printf 'export function createIdV2() { return crypto.randomUUID(); }\n' > packages/core/id-v2.ts
git add . && git commit -m "feat(core)!: migrate to crypto.randomUUID" -m "BREAKING CHANGE: The old createId() function is deprecated.

Migration guide:
- Replace createId() with createIdV2()
- Update all imports to use the new function
- Remove any polyfills for random ID generation"

# Commit with detailed body
printf 'export class EventEmitter { /* impl */ }\n' > packages/core/events.ts
git add . && git commit -m "feat(core): add event emitter" -m "Implements a lightweight event emitter for pub/sub patterns.

Features:
- Type-safe event definitions
- Automatic cleanup on unsubscribe
- Support for once() listeners"

# Multi-package commit with no scope - should appear in core, api, and dashboard
printf 'export const SHARED_VERSION = "1.0.0";\n' > packages/core/shared.ts
printf 'export { SHARED_VERSION } from "@acme/core";\n' > packages/api/version.ts
printf 'export { SHARED_VERSION } from "@acme/core";\n' > packages/dashboard/version.ts
git add . && git commit -m "feat: add shared version constant across packages"

# Non-conventional commits - should appear in "Other changes" group
printf '# Utils Package\n\nUtility functions for the monorepo.\n' > packages/utils/README.md
git add . && git commit -m "add readme to utils package"

printf '// TODO: implement caching\n' >> packages/server/create.ts
git add . && git commit -m "wip: server caching"

printf 'export const APP_NAME = "Acme";\n' > packages/config/constants.ts
git add . && git commit -m "added app name constant"

echo ""
echo ">>> Initializing Sisyphus..."
echo ""

$SIS init -y --rootChangelog

echo ""
echo ">>> Creating stones from commits..."
echo ""

$SIS version --fromCommits

echo ""
echo ">>> Dry run..."
echo ""

$SIS roll --dryRun

echo ""
echo ">>> Rolling release..."
echo ""

$SIS roll --no-npm --no-push --no-github --yes

echo ""
echo "=============================================="
echo "  PHASE 1: CHANGELOGS FROM COMMITS"
echo "=============================================="

for pkg in core utils cli web logger server config api dashboard; do
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  packages/$pkg/CHANGELOG.md"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cat "packages/$pkg/CHANGELOG.md"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CHANGELOG.md (root)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat "CHANGELOG.md"

echo ""
echo "=============================================="
echo "  PHASE 2: MANUAL STONES WITH DESCRIPTIONS"
echo "=============================================="
echo ""

# Create manual stones with descriptions
echo ">>> Creating manual stone: major bump for @acme/api..."
$SIS version -M @acme/api \
  "feat!: redesign REST API" \
  "Complete overhaul of the REST API:
- New endpoint structure following OpenAPI 3.0
- Breaking changes to authentication flow
- Removed deprecated v1 endpoints" \
  -y

echo ""
echo ">>> Creating manual stone: minor bump for @acme/web and @acme/dashboard..."
$SIS version -m @acme/web,@acme/dashboard \
  "feat: add dark mode support" \
  "Implemented system-wide dark mode:
- Automatic detection of system preferences
- Manual toggle in settings
- Persistent user preference storage" \
  -y

echo ""
echo ">>> Creating manual stone: patch bump for @acme/logger..."
$SIS version -p @acme/logger \
  "fix: resolve log rotation issue" \
  "Fixed critical bug where log files were not rotating properly after reaching max size." \
  -y

echo ""
echo ">>> Creating manual stone: multiple bump types..."
$SIS version -M @acme/server -m @acme/config -p @acme/cli \
  "chore: Q1 2026 maintenance release" \
  "Quarterly maintenance release including:
- Server: Breaking changes to WebSocket API
- Config: New environment variable support
- CLI: Bug fixes for Windows compatibility" \
  -y

echo ""
echo ">>> Rolling second release..."
$SIS roll --no-npm --no-push --no-github --yes

echo ""
echo "=============================================="
echo "  PHASE 2: CHANGELOGS WITH MANUAL STONES"
echo "=============================================="

for pkg in core utils cli web logger server config api dashboard; do
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  packages/$pkg/CHANGELOG.md"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cat "packages/$pkg/CHANGELOG.md"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CHANGELOG.md (root)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat "CHANGELOG.md"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  FINAL VERSIONS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

$SIS check

echo ""
echo "=============================================="
echo "  Test directory: $DIR"
echo "=============================================="
echo ""

if command -v zed &> /dev/null; then
  echo "Opening in Zed..."
  zed "$DIR"
fi

echo "Press ENTER to cleanup and exit..."
read -r

rm -rf "$DIR"
echo "Cleaned up!"
