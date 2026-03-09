export type ArgType = "string" | "boolean" | "number";

export type ArgValue = string | boolean | number;

export type ArgDefinition = { type: ArgType; alias?: string; default?: ArgValue; description?: string };

type ArgTypeMap = { string: string; boolean: boolean; number: number };

export type InferArgs<T extends Record<string, ArgDefinition>> = {
  [K in keyof T]: ArgTypeMap[T[K]["type"]];
};

export function args<const T extends Record<string, ArgDefinition>>(defs: T): T {
  return defs;
}
