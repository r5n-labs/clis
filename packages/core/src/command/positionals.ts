export type PositionalDefinition = { description?: string; required?: boolean; variadic?: boolean };

export type InferPositionals<T extends Record<string, PositionalDefinition>> = {
  [K in keyof T]: T[K]["variadic"] extends true
    ? string[]
    : T[K]["required"] extends true
      ? string
      : string | undefined;
};

export function positionals<const T extends Record<string, PositionalDefinition>>(defs: T): T {
  return defs;
}
