import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";

const DRY_RUN_FLAG = "--dry-run";
const FAILURE_EXIT_CODE = 1;

const argv = Bun.argv.slice(2);
const dryRun = argv.includes(DRY_RUN_FLAG);
const [packageDir] = argv.filter((arg) => arg !== DRY_RUN_FLAG);

if (!packageDir) {
  console.error(`No package provided. Usage: bun ./publish-package.ts ./packages/hydra [${DRY_RUN_FLAG}]`);
  process.exit(FAILURE_EXIT_CODE);
}

const pkgDir = resolve(packageDir);
const pkgJsonPath = resolve(pkgDir, "package.json");

if (!existsSync(pkgJsonPath)) {
  console.error(`package.json not found at ${pkgJsonPath}`);
  process.exit(FAILURE_EXIT_CODE);
}

const originalManifest = await Bun.file(pkgJsonPath).text();
let exitCode = 0;

try {
  await $`bun run package:prepare`.cwd(pkgDir);

  if (dryRun) {
    await $`bun publish --dry-run --no-git-checks --access public --force`.cwd(pkgDir);
  } else {
    await $`bun publish --access public --no-git-checks`.cwd(pkgDir);
  }
} catch (error) {
  exitCode =
    typeof error === "object" && error !== null && "exitCode" in error && typeof error.exitCode === "number"
      ? error.exitCode || FAILURE_EXIT_CODE
      : FAILURE_EXIT_CODE;
  console.error(`\n❌ Publish failed for ${packageDir}${dryRun ? " (dry run)" : ""}`);
} finally {
  await Bun.write(pkgJsonPath, originalManifest);
  console.info(`Restored original package.json at ${pkgJsonPath}`);
  await $`bun install`.cwd(pkgDir).nothrow();
}

process.exit(exitCode);
