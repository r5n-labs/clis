import fs from "node:fs";
import path from "node:path";
import { record, unknown } from "banditypes";
import { deepMerge } from "./util";

const JSON_INDENT = 2;
const configSchema = record(unknown());

export class ConfigManager<T extends object> {
  private config: T;
  private configPath: string;
  private defaultConfig: T;
  private loadError: unknown;

  constructor(filePath: string, defaultConfig: T) {
    this.configPath = path.resolve(filePath);
    this.defaultConfig = defaultConfig;

    this.config = this.loadConfig();
  }

  public get path(): string {
    return this.configPath;
  }

  public get<K extends keyof T>(key: K): T[K] {
    return this.config[key];
  }

  public set<K extends keyof T>(key: K, value: T[K]): void {
    this.config[key] = value;
    this.save();
  }

  public delete<K extends keyof T>(key: K): void {
    delete this.config[key];
    this.save();
  }

  public exists(): boolean {
    return fs.existsSync(this.configPath);
  }

  public getAll(): T {
    return structuredClone(this.config);
  }

  public save(configToSave?: T): void {
    if (this.loadError) {
      throw new Error(`Cannot overwrite unreadable config at ${this.configPath}; repair the file and try again`, {
        cause: this.loadError,
      });
    }

    if (configToSave) {
      this.config = { ...configToSave };
    }

    this.ensureDirectoryExists();

    const savePath = this.exists() ? fs.realpathSync(this.configPath) : this.configPath;
    const temporaryPath = `${savePath}.${crypto.randomUUID()}.tmp`;
    try {
      const mode = this.exists() ? fs.statSync(this.configPath).mode : undefined;
      fs.writeFileSync(temporaryPath, JSON.stringify(this.config, null, JSON_INDENT), { flag: "wx", mode });
      if (mode !== undefined) fs.chmodSync(temporaryPath, mode);
      fs.renameSync(temporaryPath, savePath);
    } catch (error) {
      throw new Error(`Failed to save config to ${this.configPath}`, { cause: error });
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }

  private ensureDirectoryExists(): void {
    const dir = path.dirname(this.configPath);

    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        throw new Error(`Failed to create config directory at ${dir}`, { cause: error });
      }
    }
  }

  private loadConfig(): T {
    if (!fs.existsSync(this.configPath)) {
      return structuredClone(this.defaultConfig);
    }

    try {
      const fileContent = fs.readFileSync(this.configPath, "utf-8");
      const value: unknown = JSON.parse(fileContent);
      if (Array.isArray(value)) throw new Error("Config must be an object");
      const parsed = configSchema(value);

      return deepMerge(structuredClone(this.defaultConfig), parsed);
    } catch (error) {
      this.loadError = error;
      console.warn(`Config file corrupted at ${this.configPath}. Using defaults.`);
      return structuredClone(this.defaultConfig);
    }
  }
}
