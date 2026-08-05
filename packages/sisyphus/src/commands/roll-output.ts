import { Exit, log, note, spinner } from "@r5n/cli-core";
import type { ReleaseReport } from "../services";

const GENERIC_FAILURE_EXIT_CODE = 1;

export type RollReporter = {
  json: boolean;
  info: (message: string) => void;
  note: (message: string, title: string) => void;
  start: (message: string) => void;
  step: (message: string) => void;
  stop: (message: string) => void;
  warn: (message: string) => void;
};

export function createRollReporter(json: boolean): RollReporter {
  if (json) {
    const noop = () => undefined;
    return { info: noop, json, note: noop, start: noop, step: noop, stop: noop, warn: noop };
  }

  const progress = spinner();

  return {
    info: (message) => log.info(message),
    json,
    note: (message, title) => note(message, title),
    start: (message) => progress.start(message),
    step: (message) => log.step(message),
    stop: (message) => progress.stop(message),
    warn: (message) => log.warn(message),
  };
}

export function emitReleaseReport(report: ReleaseReport): void {
  console.log(JSON.stringify(report, null, 2));
}

export function failWithReleaseReport(report: ReleaseReport, error: unknown): never {
  emitReleaseReport(report);
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Exit && error.hint) console.error(error.hint);

  process.exit(error instanceof Exit ? error.exitCode : GENERIC_FAILURE_EXIT_CODE);
}
