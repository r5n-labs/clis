import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { args, color, Exit, log, positionals, select } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import type { RunnerLogFile } from "../providers";
import { createProvider, formatFileSize, pickLogFile, tailLines } from "../providers";
import type { RunnerEntry } from "../types";

const DEFAULT_TAIL_LINES = 100;

const LOG_TYPE_LABELS = { runner: "runner daemon log", worker: "job log" } as const;

const logsArgs = args({
  lines: { alias: "n", default: DEFAULT_TAIL_LINES, description: "Number of lines to tail", type: "number" },
  list: {
    alias: "l",
    default: false,
    description: "List available log files instead of printing content",
    type: "boolean",
  },
  open: {
    alias: "o",
    default: false,
    description: "Open the log file in $EDITOR instead of printing",
    type: "boolean",
  },
  runner: {
    alias: "r",
    default: false,
    description: "Show the runner daemon log instead of the latest job log",
    type: "boolean",
  },
});

const logsPositionals = positionals({ id: { description: "Runner ID" } });

type LogsCtx = Ctx<typeof logsArgs, typeof logsPositionals>;

export class LogsCommand extends BaseCommand {
  name = "logs";
  description = "Inspect logs of the latest jobs";
  args = logsArgs;
  positionals = logsPositionals;

  async execute(ctx: LogsCtx) {
    const entries = ctx.config.get("runners") ?? [];

    if (entries.length === 0) {
      throw new Exit("No runners found", "Run hydra create to provision runners");
    }

    const entry = await this.resolveEntry(ctx, entries);
    const profile = ctx.config.get("profiles")[entry.profile];

    if (!profile) {
      throw new Exit(`Profile "${entry.profile}" not found for runner "${entry.id}"`, "Run hydra init to set it up");
    }

    if (!existsSync(entry.directory)) {
      throw new Exit(`Runner directory not found: ${entry.directory}`, "Run hydra create to provision this runner");
    }

    const provider = createProvider(profile);
    const files = await provider.logFiles(entry.id);

    if (files.length === 0) {
      this.noLogs(entry.id);
    }

    if (ctx.args.list) {
      this.printList(entry, files);
      return;
    }

    const file = this.selectFile(ctx, entry, files);

    if (ctx.args.open) {
      await this.openFile(file);
      return;
    }

    await this.printTail(entry, file, ctx.args.lines);
  }

  private async resolveEntry(ctx: LogsCtx, entries: RunnerEntry[]): Promise<RunnerEntry> {
    const id = ctx.positionals.id;

    if (id) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) {
        throw new Exit(`Runner "${id}" not found`, `Known runners: ${entries.map((e) => e.id).join(", ")}`);
      }
      return entry;
    }

    if (ctx.interactive) {
      return select({
        message: "Select runner",
        options: entries.map((e) => ({ hint: e.profile, label: e.name, value: e })),
      });
    }

    const single = entries[0];
    if (entries.length === 1 && single) return single;

    throw new Exit(
      "Multiple runners found",
      `Pass a runner id: hydra logs <id> (${entries.map((e) => e.id).join(", ")})`,
    );
  }

  private selectFile(ctx: LogsCtx, entry: RunnerEntry, files: RunnerLogFile[]): RunnerLogFile {
    if (ctx.args.runner) {
      const runnerLog = files.find((file) => file.type === "runner");
      if (!runnerLog) {
        throw new Exit(`No runner daemon logs found for "${entry.id}"`, "Start the runner first: hydra start");
      }
      return runnerLog;
    }

    const picked = pickLogFile(files, "worker");

    if (!picked) {
      this.noLogs(entry.id);
    }

    if (picked.fallback) {
      log.warn(color.yellow("No job (Worker) logs yet; showing the runner daemon log instead"));
    }

    return picked.file;
  }

  private noLogs(id: string): never {
    throw new Exit(`No logs found for runner "${id}"`, "Logs appear once the runner has started; run hydra start");
  }

  private printList(entry: RunnerEntry, files: RunnerLogFile[]) {
    const lines = [`${color.bold(entry.name)} ${color.dim(entry.directory)}`];

    for (const file of files) {
      const type = file.type === "worker" ? color.green("worker") : color.blue("runner");
      lines.push(`  ${type} ${file.name} ${color.dim(`${file.mtime.toISOString()} · ${formatFileSize(file.size)}`)}`);
    }

    log.info(lines.join("\n"));
  }

  private async printTail(entry: RunnerEntry, file: RunnerLogFile, lines: number) {
    const content = await readFile(file.path, "utf-8");
    const header = [
      `${color.bold(entry.name)} ${color.dim(LOG_TYPE_LABELS[file.type])}`,
      color.dim(file.path),
      color.dim(`Last modified: ${file.mtime.toISOString()}`),
    ];

    log.info(header.join("\n"));
    console.log(tailLines(content, lines));
  }

  private async openFile(file: RunnerLogFile) {
    const editorParts = (process.env.EDITOR ?? "").split(" ").filter(Boolean);
    const editor = editorParts[0];

    if (editor) {
      const proc = Bun.spawn([editor, ...editorParts.slice(1), file.path], {
        stderr: "inherit",
        stdin: "inherit",
        stdout: "inherit",
      });
      await proc.exited;
      return;
    }

    if (process.platform === "darwin") {
      await Bun.$`open ${file.path}`.quiet();
      return;
    }

    throw new Exit("No editor configured", "Set $EDITOR to open log files");
  }
}
