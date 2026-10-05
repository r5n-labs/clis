import { Exit } from "@r5n/cli-core";
import * as publishManifest from "@r5n/tools/scripts/publish-manifest";
import type { Package } from "../domain";

export function workspaceVersionsFromPackages(packages: Iterable<Package>): publishManifest.WorkspaceVersionMap {
  return Object.fromEntries(
    Array.from(packages, (pkg) => [pkg.name, { isPrivate: pkg.isPrivate, version: pkg.version || null }]),
  );
}

export function renderPublishManifest(
  originalText: string,
  catalogs: publishManifest.CatalogMap,
  workspaceVersions: publishManifest.WorkspaceVersionMap,
): string {
  try {
    return publishManifest.renderPublishManifest(originalText, catalogs, workspaceVersions);
  } catch (error) {
    throw error instanceof publishManifest.PublishManifestError ? new Exit(error.message, error.hint) : error;
  }
}
