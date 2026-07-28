import { Exit } from "../exit";
import { log } from "../prompts";
import { color } from "./color";

const MAX_ERROR_CAUSE_DEPTH = 4;

export function logErrorCauses(error: Error, depth = 0): void {
  if (depth >= MAX_ERROR_CAUSE_DEPTH) return;

  const nested = [
    ...(error instanceof AggregateError ? error.errors : []),
    ...(error.cause !== undefined ? [error.cause] : []),
  ];

  for (const item of nested) {
    log.info(color.dim(`caused by: ${item instanceof Error ? item.message : String(item)}`));
    if (item instanceof Exit && item.hint) log.info(color.dim(`  ${item.hint}`));
    if (item instanceof Error) logErrorCauses(item, depth + 1);
  }
}
