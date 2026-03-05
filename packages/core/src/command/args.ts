export type ArgType = "string" | "boolean";

export type ArgDefinition = { type: ArgType; alias?: string; default?: string | boolean; description?: string };

type ArgTypeMap = { string: string; boolean: boolean };

export type InferArgs<T extends Record<string, ArgDefinition>> = {
  [K in keyof T]: ArgTypeMap[T[K]["type"]];
};

export function args<const T extends Record<string, ArgDefinition>>(defs: T): T {
  return defs;
}
