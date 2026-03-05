import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SIZE_BUDGETS_KB = { l: 500, m: 200, s: 100, xl: 1000, xs: 50 };

type SizeBudget = keyof typeof SIZE_BUDGETS_KB | number;

interface BuilderOptions {
  entrypoints: string[];
  maxSize?: SizeBudget;
  name?: string;
  packages?: "bundle" | "external";
  updateReadme?: boolean;
}

async function updateReadmeBadge(sizeKB: number, packageDir: string) {
  const readmePath = resolve(packageDir, "README.md");

  if (!existsSync(readmePath)) {
    console.warn(`⚠️  README not found at ${readmePath}, skipping badge update`);
    return;
  }

  const file = Bun.file(readmePath);
  let content = await file.text();

  const sizeBadgePattern = /https:\/\/img\.shields\.io\/badge\/bundle[_%20]size-~?\d+KB-green\.svg/g;
  const newBadge = `https://img.shields.io/badge/bundle_size-~${sizeKB}KB-green.svg`;

  if (!sizeBadgePattern.test(content)) {
    console.warn(`⚠️  No bundle size badge found in ${readmePath}`);
    return;
  }

  content = content.replace(sizeBadgePattern, newBadge);

  const textSizePattern = /\*\*\d+KB (of Pure Speed|of Excellence)\*\*/g;
  content = content.replace(textSizePattern, `**${sizeKB}KB $1**`);

  await Bun.write(readmePath, content);
  console.info(`   📝 Updated README.md badge to ${sizeKB}KB`);
}

export async function bunPackageBuilder({
  maxSize,
  type,
  packages = "external",
  updateReadme = false,
  ...options
}: Omit<BuilderOptions & Partial<Parameters<typeof Bun.build>[0]>, "entrypoints"> & {
  type?: "cli";
  entrypoints?: string[];
}) {
  try {
    await Bun.$`bun run type-check`;
  } catch (_e) {
    console.error("\n❌ Type check failed. Aborting build.");
    process.exit(1);
  }

  const pkgJson = (await Bun.file("package.json").json()) as {
    types: string;
    main: string;
    exports: Record<string, { bun: string }>;
    name: string;
  };

  const parsedEntrypoints =
    type === "cli"
      ? [`./${pkgJson.types}`]
      : Object.entries(pkgJson.exports)
          .map(([, { bun }]) => bun)
          .filter(Boolean);
  const entrypoints = options.entrypoints || parsedEntrypoints;

  if (!entrypoints || entrypoints.length === 0) {
    throw new Error("No entrypoints provided for build");
  }

  const packageName = pkgJson.name || "unknown-package";

  const build = await Bun.build({
    entrypoints,
    minify: true,
    outdir: "./dist",
    packages,
    sourcemap: "none",
    ...options,
  });

  if (!build.success) {
    const errorMessage = `Build failed for ${packageName}\n${build.logs.join("\n")}`;
    throw new Error(errorMessage);
  }

  if (!build.outputs || build.outputs.length === 0) {
    throw new Error(`No outputs generated for ${packageName}`);
  }

  const totalSize = build.outputs.reduce((sum, output) => sum + (output.size || 0), 0);
  const sizeInKB = (totalSize / 1024).toFixed(2);
  const roundedSizeKB = Math.round(totalSize / 1024);

  if (maxSize) {
    const budgetKB = typeof maxSize === "number" ? maxSize : SIZE_BUDGETS_KB[maxSize];
    const actualKB = totalSize / 1024;

    if (actualKB > budgetKB) {
      const overBy = (actualKB - budgetKB).toFixed(2);
      throw new Error(`❌ ${packageName} exceeds size budget: ${sizeInKB}KB > ${budgetKB}KB (over by ${overBy}KB)`);
    }
  }

  console.info(
    `✅ ${packageName} build successful (${sizeInKB} KB, ${build.outputs.length} file${build.outputs.length > 1 ? "s" : ""})`,
  );

  if (updateReadme) {
    await updateReadmeBadge(roundedSizeKB, process.cwd());
  }

  if (process.platform !== "win32" && type === "cli") {
    await Bun.$`chmod +x ./${pkgJson.main}`.quiet();
  }

  return true;
}
