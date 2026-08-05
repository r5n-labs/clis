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

export function redirectStdoutToStderr(): () => void {
  const original = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
    (process.stderr.write as (...args: unknown[]) => boolean)(chunk, ...rest)) as typeof process.stdout.write;

  return () => {
    process.stdout.write = original;
  };
}

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

export function emitReleaseReport(report: ReleaseReport, restoreStdout?: () => void): void {
  restoreStdout?.();
  console.log(JSON.stringify(report, null, 2));
}

export function failWithReleaseReport(report: ReleaseReport, error: unknown, restoreStdout?: () => void): never {
  emitReleaseReport(report, restoreStdout);
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Exit && error.hint) console.error(error.hint);
  for (const cause of report.error?.causes ?? []) console.error(cause);

  process.exit(error instanceof Exit ? error.exitCode : GENERIC_FAILURE_EXIT_CODE);
}
