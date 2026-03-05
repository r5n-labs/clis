import fs from "node:fs";
import path from "node:path";
import { deepMerge } from "./util";

export class ConfigManager<T extends object> {
  private config: T;
  private configPath: string;
  private defaultConfig: T;

  constructor(filePath: string, defaultConfig: T) {
    this.configPath = path.resolve(filePath);
    this.defaultConfig = defaultConfig;

    this.config = this.loadConfig();
  }

  public get<K extends keyof T>(key: K): T[K] {
    return this.config[key];
  }

  public set<K extends keyof T>(key: K, value: T[K]): void {
    this.config[key] = value;
    this.save();
  }

  public exists(): boolean {
    return fs.existsSync(this.configPath);
  }

  public getAll(): T {
    return deepMerge({} as T, this.config);
  }

  public save(configToSave?: T): void {
    if (configToSave) {
      this.config = { ...configToSave };
    }

    this.ensureDirectoryExists();

    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error(`Failed to save config to ${this.configPath}:`, error);
    }
  }

  private ensureDirectoryExists(): void {
    const dir = path.dirname(this.configPath);

    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create config directory at ${dir}:`, error);
      }
    }
  }

  private loadConfig(): T {
    if (!fs.existsSync(this.configPath)) {
      return { ...this.defaultConfig };
    }

    try {
      const fileContent = fs.readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(fileContent);

      return deepMerge({ ...this.defaultConfig }, parsed);
    } catch {
      console.warn(`Config file corrupted at ${this.configPath}. Using defaults.`);
      return { ...this.defaultConfig };
    }
  }
}
