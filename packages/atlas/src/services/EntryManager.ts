import { homedir, hostname } from "node:os";
import { basename, normalize, resolve } from "node:path";
import type { ConfigManager } from "@r5n/cli-core";
import type { AtlasConfig, EntryType, TrackedEntry } from "../types";

export type AddEntryOptions = {
  source: string;
  tags?: string[];
  type: EntryType;
  preset?: string;
  encrypt?: boolean;
};

export class EntryManager {
  constructor(private config: ConfigManager<AtlasConfig>) {}

  add(options: AddEntryOptions): TrackedEntry {
    const resolvedSource = resolvePath(options.source);

    if (this.exists(resolvedSource)) {
      throw new Error(`Entry already tracked: ${resolvedSource}`);
    }

    const cfg = this.config.getAll();
    const existingIds = cfg.entries.map((e) => e.id);
    const id = generateId(resolvedSource, existingIds);

    const entry: TrackedEntry = {
      id,
      source: resolvedSource,
      tags: buildTags(options.tags ?? [], cfg.os, hostname()),
      type: options.type,
      preset: options.preset,
      encrypt: options.encrypt ?? false,
    };

    this.config.set("entries", [...cfg.entries, entry]);
    return entry;
  }

  remove(idOrPath: string): boolean {
    const cfg = this.config.getAll();
    const entry = findEntry(cfg.entries, idOrPath);

    if (!entry) return false;

    const filtered = cfg.entries.filter((e) => e.id !== entry.id);
    this.config.set("entries", filtered);
    return true;
  }

  list(tagFilter?: string[]): TrackedEntry[] {
    const entries = this.config.getAll().entries;

    if (!tagFilter || tagFilter.length === 0) return entries;

    return entries.filter((entry) =>
      tagFilter.every((tag) => entry.tags.includes(tag)),
    );
  }

  get(idOrPath: string): TrackedEntry | undefined {
    return findEntry(this.config.getAll().entries, idOrPath);
  }

  exists(source: string): boolean {
    const resolved = resolvePath(source);
    return this.config
      .getAll()
      .entries.some((e) => normalizePath(e.source) === normalizePath(resolved));
  }
}

function resolvePath(p: string): string {
  if (p.startsWith("~")) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

function normalizePath(p: string): string {
  return normalize(resolvePath(p));
}

function findEntry(
  entries: TrackedEntry[],
  idOrPath: string,
): TrackedEntry | undefined {
  const byId = entries.find((e) => e.id === idOrPath);
  if (byId) return byId;

  const resolved = normalizePath(idOrPath);
  return entries.find((e) => normalizePath(e.source) === resolved);
}

function slugify(name: string): string {
  return name.replace(/[/.]/g, "-").replace(/^-+|-+$/g, "");
}

function generateId(source: string, existingIds: string[]): string {
  const base = slugify(basename(source));
  if (!existingIds.includes(base)) return base;

  let suffix = 2;
  while (existingIds.includes(`${base}-${suffix}`)) {
    suffix++;
  }
  return `${base}-${suffix}`;
}

function buildTags(
  userTags: string[],
  os: string,
  machine: string,
): string[] {
  const tags = Array.from(new Set([...userTags, `os:${os}`, `machine:${machine}`]));
  return tags;
}
