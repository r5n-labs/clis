import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ConfigManager, color, log } from "@r5n/cli-core";
import { DEFAULT_CONFIG_DIR, DEFAULT_RELEASED_DIR, DEFAULT_STONES_DIR } from "../constants";
import { Stone, type StoneData, type StoneJson } from "../domain";
import type { SisyphusConfig } from "../types";

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
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
      .sort();
  }

  async get(id: string): Promise<Stone | null> {
    const filePath = this.getFilePath(id);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const json: StoneJson = JSON.parse(content);
      return Stone.fromJson(json);
    } catch {
      return null;
    }
  }

  async exists(id: string): Promise<boolean> {
    return existsSync(this.getFilePath(id));
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

  async count(): Promise<number> {
    const ids = await this.listIds();
    return ids.length;
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
        await rename(sourcePath, destPath);
        this.removeFromConfigStones(stone.id);
      }
    }

    return timestamp;
  }

  async getReleasedStones(timestamp: string): Promise<Stone[]> {
    const archiveDir = join(this.releasedPath, timestamp);
    if (!existsSync(archiveDir)) return [];

    const files = await readdir(archiveDir);
    const stones: Stone[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      try {
        const content = await readFile(join(archiveDir, file), "utf-8");
        const json: StoneJson = JSON.parse(content);
        stones.push(Stone.fromJson(json));
      } catch (error) {
        log.warn(color.dim(`Failed to parse stone "${file}": ${error}`));
      }
    }

    return stones;
  }

  async listReleasedTimestamps(): Promise<string[]> {
    if (!existsSync(this.releasedPath)) return [];

    const entries = await readdir(this.releasedPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  async getAllTrackedCommitHashes(): Promise<Set<string>> {
    const pending = await this.list();
    const hashes = pending.flatMap((stone) => stone.commits ?? []).map((commit) => commit.hash);
    return new Set(hashes);
  }

  async listAllStones(): Promise<Stone[]> {
    const pending = await this.list();
    const timestamps = await this.listReleasedTimestamps();
    const released = await Promise.all(timestamps.map((t) => this.getReleasedStones(t)));
    return [...pending, ...released.flat()];
  }

  getFilePath(id: string): string {
    return join(this.stonesPath, `${id}.json`);
  }

  private createTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
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
