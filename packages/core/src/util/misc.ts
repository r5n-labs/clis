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
  const isObject = (obj: any) => obj && typeof obj === "object";

  if (!isObject(target) || !isObject(source)) {
    return source;
  }

  const result = { ...target };
  for (const key of Object.keys(source)) {
    const targetValue = result[key];
    const sourceValue = source[key];

    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      result[key] = [...sourceValue];
    } else if (isObject(targetValue) && isObject(sourceValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}
