import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Exit } from "@r5n/cli-core";
import { DEFAULT_NPM_TAG } from "../../constants";
import type { Package } from "../../domain";
import { parseSemver } from "../../domain/semver";
import { getErrorDetail } from "./run";

const NPM_TAG_PATTERN = /^[A-Za-z][0-9A-Za-z._-]*$/;
const SEMVER_LIKE_NPM_TAG_PATTERN =
  /^(?:[vV]?\d+(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|[xX])$/;

export function isValidNpmTag(tag: string): boolean {
  return NPM_TAG_PATTERN.test(tag) && !SEMVER_LIKE_NPM_TAG_PATTERN.test(tag);
}

export function getNpmTag(configuredTag: string): string {
  const tag = (configuredTag || DEFAULT_NPM_TAG).trim();
  if (!isValidNpmTag(tag)) {
    throw new Exit(
      `Invalid npm dist-tag "${tag}"`,
      "Use a non-semver tag containing only letters, numbers, dots, underscores, or hyphens",
    );
  }
  return tag;
}

export function resolveReleaseNpmTag(packages: readonly Package[], configuredTag: string): string {
  const configured = getNpmTag(configuredTag);
  const channels = new Set<string>();

  for (const pkg of packages) {
    if (pkg.isPrivate) continue;
    const channel = prereleaseChannel(pkg.newVersion ?? pkg.version);
    channels.add(channel ?? configured);
  }

  if (channels.size <= 1) return [...channels][0] ?? configured;

  throw new Exit(
    `Release mixes npm dist-tags (${[...channels].sort().join(", ")})`,
    "Roll stable and prerelease packages separately, or give every prerelease the same tag",
  );
}

function prereleaseChannel(version: string): string | undefined {
  const parsed = parseSemver(version);
  if (!parsed || parsed.prerelease.length === 0) return undefined;

  const [identifier] = parsed.prerelease;
  if (typeof identifier !== "string") return undefined;

  const channel = identifier.split("-")[0];
  return channel && isValidNpmTag(channel) ? channel : undefined;
}

export function getPackageScope(packageName: string): string | undefined {
  return packageName.startsWith("@") ? packageName.split("/")[0] : undefined;
}

export function getScopeRegistryArgs(packageName: string, registry: string): string[] {
  const scope = getPackageScope(packageName);
  return scope ? [`--${scope}:registry=${registry}`] : [];
}

export async function resolveNpmRegistry(pkg: Package): Promise<string> {
  const scope = getPackageScope(pkg.name);
  if (scope) {
    const scopedResult = await Bun.$`npm config get ${`${scope}:registry`}`.cwd(dirname(pkg.file)).quiet().nothrow();
    if (scopedResult.exitCode === 0) {
      const value = scopedResult.stdout.toString().trim();
      if (value && value !== "undefined" && value !== "null") {
        const registry = parseNpmRegistry(value);
        if (registry) return registry;
        throw new Exit(
          `Invalid ${scope}:registry for ${pkg.name}`,
          "Registry must be a credential-free HTTP or HTTPS URL",
        );
      }
    }
  }

  const manifest = await readPackageManifest(pkg);
  const publishConfig = manifest.publishConfig;
  if (publishConfig !== undefined) {
    if (typeof publishConfig !== "object" || publishConfig === null || Array.isArray(publishConfig)) {
      throw new Exit(`Invalid publishConfig in ${pkg.name}`, "publishConfig must be an object");
    }
    const configuredRegistry = Reflect.get(publishConfig, "registry");
    if (configuredRegistry !== undefined) {
      if (typeof configuredRegistry !== "string") {
        throw new Exit(`Invalid publishConfig.registry in ${pkg.name}`, "Registry must be an HTTP or HTTPS URL");
      }
      const registry = parseNpmRegistry(configuredRegistry);
      if (!registry) {
        throw new Exit(
          `Invalid publishConfig.registry in ${pkg.name}`,
          "Registry must be a credential-free HTTP or HTTPS URL",
        );
      }
      return registry;
    }
  }

  const environmentRegistry = process.env.NPM_CONFIG_REGISTRY ?? process.env.npm_config_registry;
  if (environmentRegistry) {
    const registry = parseNpmRegistry(environmentRegistry);
    if (registry) return registry;
  }

  const result = await Bun.$`npm config get registry`.cwd(dirname(pkg.file)).quiet().nothrow();
  if (result.exitCode === 0) {
    const value = result.stdout.toString().trim();
    if (value && value !== "undefined" && value !== "null") {
      const registry = parseNpmRegistry(value);
      if (registry) return registry;
    }
  }

  throw new Exit(
    `Cannot resolve a credential-free npm registry for ${pkg.name}`,
    "Configure registry or @scope:registry as an HTTP or HTTPS URL without embedded credentials",
  );
}

export function parseNpmRegistry(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function readPublishedPackage(
  metadata: unknown,
): { integrity: string; name: string; version: string } | undefined {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return undefined;
  const name = Reflect.get(metadata, "name");
  const version = Reflect.get(metadata, "version");
  const dist = Reflect.get(metadata, "dist");
  if (typeof dist !== "object" || dist === null || Array.isArray(dist)) return undefined;
  const integrity = Reflect.get(dist, "integrity");
  if (typeof name !== "string" || typeof version !== "string" || typeof integrity !== "string") return undefined;
  return { integrity, name, version };
}

export async function readPackageManifest(pkg: Package): Promise<Record<string, unknown>> {
  let content: string;
  try {
    content = await readFile(pkg.file, "utf-8");
  } catch (error) {
    throw new Error(`Failed to read ${pkg.name}: ${getErrorDetail(error)}`);
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse ${pkg.name}: ${getErrorDetail(error)}`);
  }

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error(`Invalid ${pkg.name} manifest object`);
  }

  return manifest as Record<string, unknown>;
}

export async function getPublishablePackages(packages: Package[]): Promise<Package[]> {
  const publishablePackages: Package[] = [];

  for (const pkg of packages) {
    const manifest = await readPackageManifest(pkg);
    const privateValue = manifest.private;

    if (privateValue !== undefined && typeof privateValue !== "boolean") {
      throw new Error(`Failed to validate ${pkg.name} manifest: "private" must be a boolean`);
    }
    if (privateValue) continue;

    publishablePackages.push(pkg);
  }

  return publishablePackages;
}
