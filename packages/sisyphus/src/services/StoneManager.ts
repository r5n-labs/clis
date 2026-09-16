import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type ConfigManager, color, Exit, log } from "@r5n/cli-core";
import { DEFAULT_CONFIG_DIR, DEFAULT_RELEASED_DIR, DEFAULT_STONES_DIR } from "../constants";
import { Stone, type StoneData, type StoneJson } from "../domain";
import type { SisyphusConfig } from "../types";

const STONE_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z_-]*$/;
const RELEASE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export class StoneManager {
  constructor(private config: ConfigManager<SisyphusConfig>) {}

  private get sisyphusDir(): string {
    return this.config.get("sisyphusDir") || DEFAULT_CONFIG_DIR;
  }

  private get stonesPath(): string {
    return this.config.get("stonesPath") || join(this.sisyphusDir, DEFAULT_STONES_DIR);
  }

  private get releasedPath(): string {
    return join(this.sisyphusDir, DEFAULT_RELEASED_DIR);
  }

  async list(): Promise<Stone[]> {
    const ids = await this.listIds();
    const stones: Stone[] = [];

    for (const id of ids) {
      const stone = await this.get(id);
      if (stone) stones.push(stone);
    }

    return stones;
  }

  async listIds(): Promise<string[]> {
    await this.ensureStorageExists();

    const files = await readdir(this.stonesPath);
    return files
      .filter((file) => file.endsWith(".json"))
      .map((file) => this.toStoneId(file))
      .sort();
  }

  async get(id: string): Promise<Stone | null> {
    const filePath = this.getFilePath(id);

    if (!existsSync(filePath)) {
      return null;
    }

    const content = await readFile(filePath, "utf-8");
    const json = this.parseStoneJson(content, filePath);
    if (json.id !== id) {
      throw new Error(`Stone file ID mismatch: expected "${id}", found "${String(json.id)}"`);
    }
    return Stone.fromJson(json);
  }

  private parseStoneJson(content: string, filePath: string): StoneJson {
    try {
      return JSON.parse(content);
    } catch {
      throw new Exit(`Failed to parse stone file ${filePath}`, "Remove or fix the file");
    }
  }

  async save(stone: Stone): Promise<void> {
    await this.ensureStorageExists();

    const filePath = this.getFilePath(stone.id);
    const content = JSON.stringify(stone.toJson(), null, 2);

    await writeFile(filePath, content, "utf-8");
    this.addToConfigStones(stone.id);
  }

  async delete(id: string): Promise<boolean> {
    const filePath = this.getFilePath(id);

    if (!existsSync(filePath)) {
      return false;
    }

    await unlink(filePath);
    this.removeFromConfigStones(id);
    return true;
  }

  async deleteMany(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (await this.delete(id)) {
        deleted++;
      }
    }
    return deleted;
  }

  async create(data: StoneData): Promise<Stone> {
    const existingIds = await this.listIds();
    const stone = Stone.create(data, existingIds.length);
    await this.save(stone);
    return stone;
  }

  async archive(stones: Stone[]): Promise<string> {
    if (stones.length === 0) return "";

    const timestamp = this.createTimestamp();
    const archiveDir = join(this.releasedPath, timestamp);

    await mkdir(archiveDir, { recursive: true });

    for (const stone of stones) {
      const sourcePath = this.getFilePath(stone.id);
      const destPath = join(archiveDir, `${stone.id}.json`);

      if (existsSync(sourcePath)) {
        await writeFile(destPath, JSON.stringify(stone.toJson(), null, 2), "utf-8");
        await unlink(sourcePath);
        this.removeFromConfigStones(stone.id);
      }
    }

    return timestamp;
  }

  async getReleasedStones(timestamp: string, expectedIds?: readonly string[]): Promise<Stone[]> {
    const archiveDir = this.getArchivePath(timestamp);
    if (!existsSync(archiveDir)) return [];

    const files = await readdir(archiveDir);
    const jsonFiles = files.filter((file) => file.endsWith(".json")).sort();
    const expectedFiles = expectedIds?.map((id) => `${this.validateId(id)}.json`).sort();
    if (expectedFiles && JSON.stringify(jsonFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error(
        `Released stone archive ${timestamp} does not match currentRelease: expected ${expectedFiles.join(", ") || "no stones"}, found ${jsonFiles.join(", ") || "no stones"}`,
      );
    }

    const stones: Stone[] = [];

    for (const file of jsonFiles) {
      try {
        const fileId = this.validateId(file.slice(0, -".json".length));
        const stonePath = join(archiveDir, file);
        const content = await readFile(stonePath, "utf-8");
        const json = this.parseStoneJson(content, stonePath);
        if (json.id !== fileId) {
          throw new Error(`Stone file ID mismatch: expected "${fileId}", found "${String(json.id)}"`);
        }
        stones.push(Stone.fromJson(json));
      } catch (error) {
        if (expectedIds) throw error;
        log.warn(color.dim(`Failed to parse stone "${file}": ${error}`));
      }
    }

    return stones;
  }

  async listReleasedTimestamps(): Promise<string[]> {
    if (!existsSync(this.releasedPath)) return [];

    const entries = await readdir(this.releasedPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && RELEASE_TIMESTAMP_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  }

  async getTrackedCommitPackages(): Promise<Map<string, Set<string>>> {
    const pending = await this.list();
    const tracked = new Map<string, Set<string>>();

    for (const commit of pending.flatMap((stone) => stone.commits ?? [])) {
      const covered = tracked.get(commit.hash) ?? new Set<string>();
      for (const name of commit.packages) {
        covered.add(name);
      }
      tracked.set(commit.hash, covered);
    }

    return tracked;
  }

  getFilePath(id: string): string {
    const validId = this.validateId(id);
    return this.resolveChildPath(
      this.stonesPath,
      `${validId}.json`,
      `Stone path must be a direct child of the stones directory: ${id}`,
    );
  }

  getFilePaths(stones: readonly Stone[]): string[] {
    return stones.map((stone) => this.getFilePath(stone.id));
  }

  private createTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  private getArchivePath(timestamp: string): string {
    if (!RELEASE_TIMESTAMP_PATTERN.test(timestamp)) {
      throw new Error(`Invalid released stone timestamp "${timestamp}"`);
    }

    return this.resolveChildPath(
      this.releasedPath,
      timestamp,
      `Released stone archive must be a direct child of the released directory: ${timestamp}`,
    );
  }

  private resolveChildPath(parentDir: string, name: string, message: string): string {
    const parent = resolve(parentDir);
    const childPath = resolve(parent, name);

    if (dirname(childPath) !== parent) {
      throw new Error(message);
    }

    return childPath;
  }

  private validateId(id: string): string {
    if (!STONE_ID_PATTERN.test(id)) {
      throw new Error(`Invalid stone ID "${id}"`);
    }
    return id;
  }

  private toStoneId(file: string): string {
    const id = file.slice(0, -".json".length);
    if (STONE_ID_PATTERN.test(id)) return id;

    throw new Exit(
      `Invalid stone ID "${id}" from stone file ${file} in ${this.stonesPath}`,
      "Remove or rename the file; stone files must match <seq>-<hash>.json",
    );
  }

  private async ensureStorageExists(): Promise<void> {
    if (!existsSync(this.stonesPath)) {
      await mkdir(this.stonesPath, { recursive: true });
    }
  }

  private addToConfigStones(id: string): void {
    const cfg = this.config.getAll();
    if (!cfg.stones.includes(id)) {
      this.config.set("stones", [...cfg.stones, id]);
    }
  }

  private removeFromConfigStones(id: string): void {
    const cfg = this.config.getAll();
    const filtered = cfg.stones.filter((s) => s !== id);
    if (filtered.length !== cfg.stones.length) {
      this.config.set("stones", filtered);
    }
  }
}
