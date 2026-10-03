import { closest } from "fastest-levenshtein";
import { color } from "./color";

export function handleUnknownItem(type: string, name: string, available: string[], helpPath: string): never {
  const suggestion = closest(name, available);

  console.error(color.red(`Unknown ${type}: ${name}`));
  if (suggestion) console.error(color.yellow(`Did you mean "${suggestion}"?`));
  console.error(`\nRun "${helpPath} --help" for usage.`);
  process.exit(1);
}

export function deepMerge<T>(target: any, source: any): T {
  if (Array.isArray(source)) return [...source] as T;
  if (!isRecord(target) || !isRecord(source)) return source;

  return Object.fromEntries([
    ...Object.entries(target),
    ...Object.entries(source).map(([key, value]) => [
      key,
      deepMerge(Object.hasOwn(target, key) ? target[key] : undefined, value),
    ]),
  ]) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
