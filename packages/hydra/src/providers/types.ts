export type RunnerStatus = "running" | "stopped" | "registered" | "unknown";

export type RunnerInfo = {
  id: string;
  name: string;
  directory: string;
  status: RunnerStatus;
  pid?: number;
};

export type DownloadResult = {
  version: string;
  path: string;
};

export interface RunnerProvider {
  download(): Promise<DownloadResult>;
  create(count: number): Promise<RunnerInfo[]>;
  remove(ids: string[]): Promise<void>;
  start(ids: string[]): Promise<void>;
  stop(ids: string[]): Promise<void>;
  list(): Promise<RunnerInfo[]>;
}
