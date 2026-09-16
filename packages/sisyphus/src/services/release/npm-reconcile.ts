import { dirname } from "node:path";
import { Exit } from "@r5n/cli-core";
import type { Package } from "../../domain";
import type { ReleaseLedger } from "../release-ledger";
import { getScopeRegistryArgs, readPublishedPackage } from "./npm-registry";

export async function reconcileNpmPublication(ledger: ReleaseLedger, pkg: Package): Promise<void> {
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
    throw new Exit(
      `Cannot safely resume npm publication for ${packageSpec}`,
      `The registry at ${registry} does not confirm ${packageSpec}; if the version is truly absent, publish the durable artifact at ${ledger.resolveArtifactPath(pkg.name)} manually and re-run sis roll --resume`,
    );
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
