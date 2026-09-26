import { clearLine, cursorTo } from "node:readline";
import type { RetryNotice } from "../providers/jev/retries";

const BAR_WIDTH = 24;
const DEFAULT_COLUMNS = 80;
const BAR_PADDING = 3;
const PERCENT_SCALE = 100;
const SECOND_MS = 1000;

type ProgressOutput = NodeJS.WritableStream & Partial<Pick<NodeJS.WriteStream, "isTTY" | "columns">>;
type ReviewTask = {
  model: string;
  total: number;
  run: (update: (completed: number, total?: number) => void) => Promise<void>;
};

export class ReviewProgress {
  constructor(private readonly output: ProgressOutput = process.stderr) {}

  retry({ reason, retry, retries, delayMs }: RetryNotice): void {
    if (this.output.isTTY) this.clear();
    this.output.write(`${reason}; retry ${retry}/${retries} in at least ${Math.ceil(delayMs / SECOND_MS)}s…\n`);
  }

  async track({ model, total, run }: ReviewTask): Promise<void> {
    let completed = 0;
    this.output.write(`Reviewing ${total} requests with ${model}…\n`);
    const update = (done: number, currentTotal?: number) => {
      total = currentTotal ?? total;
      completed = done;
      if (this.output.isTTY) this.render(completed, total);
    };
    update(completed);
    try {
      await run(update);
      this.finish(`Saved ${completed}/${total} requests`);
    } catch (error) {
      this.finish(`Stopped after saving ${completed}/${total} requests`);
      throw error;
    }
  }

  private render(completed: number, total: number): void {
    const ratio = total > 0 ? completed / total : 1;
    const label = `${completed}/${total} requests saved (${Math.floor(ratio * PERCENT_SCALE)}%)`;
    const available = (this.output.columns || DEFAULT_COLUMNS) - label.length - BAR_PADDING;
    const width = Math.max(0, Math.min(BAR_WIDTH, available));
    const filled = Math.floor(ratio * width);
    const bar = width ? `[${"=".repeat(filled)}${"-".repeat(width - filled)}] ` : "";
    this.clear();
    this.output.write(`${bar}${label}`);
  }

  private finish(message: string): void {
    if (this.output.isTTY) this.clear();
    this.output.write(`${message}\n`);
  }

  private clear(): void {
    cursorTo(this.output, 0);
    clearLine(this.output, 0);
  }
}
