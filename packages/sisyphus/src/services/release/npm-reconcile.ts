import { dirname } from "node:path";
import { Exit } from "@r5n/cli-core";
import type { Package } from "../../domain";
import type { ReleaseLedger } from "../release-ledger";
import { calculateIntegrity } from "../release-ledger/storage";
import { getScopeRegistryArgs, readPublishedPackage } from "./npm-registry";

const MISSING_FROM_REGISTRY = /\bE404\b/;
const PUBLISH_CONFLICT = /cannot publish over|EPUBLISHCONFLICT/i;

export async function reconcileNpmPublication(
  ledger: ReleaseLedger,
  pkg: Package,
  publish: () => Promise<void>,
): Promise<void> {
  const artifact = ledger.data.artifacts[pkg.name];
  if (!artifact) throw new Error(`Release artifact is missing for ${pkg.name}`);
  const registry = ledger.data.operations.npmRegistries[pkg.name];
  if (!registry) throw new Error(`Npm registry is not configured for ${pkg.name}`);
  const version = pkg.newVersion ?? pkg.version;
  const packageSpec = `${pkg.name}@${version}`;
  const scopeRegistryArgs = getScopeRegistryArgs(pkg.name, registry);
  const result = await Bun.$`npm view ${packageSpec} --json --registry ${registry} ${scopeRegistryArgs}`
    .cwd(dirname(pkg.file))
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    if (!MISSING_FROM_REGISTRY.test(`${result.stdout.toString()}\n${result.stderr.toString()}`)) {
      throw new Exit(
        `Cannot safely resume npm publication for ${packageSpec}: ${registry} did not confirm whether it exists`,
        "Check the registry connectivity and authentication, then re-run sis roll --resume",
      );
    }
    await republish(ledger, pkg, packageSpec, registry, publish);
    return;
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(result.stdout.toString());
  } catch {
    throw new Exit(`Cannot safely resume npm publication for ${packageSpec}`, "Registry metadata is not valid JSON");
  }

  const published = readPublishedPackage(metadata);
  if (!published) {
    throw new Exit(
      `Cannot safely resume npm publication for ${packageSpec}`,
      "Registry metadata does not report name, version, and dist.integrity; verify the upload manually",
    );
  }
  if (published.name !== pkg.name || published.version !== version || published.integrity !== artifact.integrity) {
    throw new Exit(
      `Cannot safely resume npm publication for ${packageSpec}: artifact integrity does not match`,
      "Do not republish this version; compare the registry artifact with the durable release artifact",
    );
  }

  await ledger.markNpm(pkg.name, "completed");
}

async function republish(
  ledger: ReleaseLedger,
  pkg: Package,
  packageSpec: string,
  registry: string,
  publish: () => Promise<void>,
): Promise<void> {
  const artifactPath = ledger.resolveArtifactPath(pkg.name);
  if ((await calculateIntegrity(artifactPath)) !== ledger.data.artifacts[pkg.name]?.integrity) {
    throw new Exit(
      `Cannot safely republish ${packageSpec}: the durable artifact no longer matches the release ledger`,
      `Restore ${artifactPath} from the original release before resuming`,
    );
  }

  try {
    await publish();
  } catch (error) {
    if (error instanceof Error && PUBLISH_CONFLICT.test(error.message)) {
      throw new Exit(
        `${packageSpec} was already accepted by ${registry} but is not listed yet`,
        "npm may still be processing or holding the upload; re-run sis roll --resume once the version is visible",
      );
    }
    throw error;
  }

  await ledger.markNpm(pkg.name, "completed");
}
