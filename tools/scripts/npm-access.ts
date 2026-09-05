import { enums, fail, objectLoose, optional, unknown } from "banditypes";

type NpmAccess = "public" | "restricted";

const objectSchema = unknown().map((value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : fail(),
);
const accessSchema = objectSchema.map(
  objectLoose<{ publishConfig?: { access?: NpmAccess } }>({
    publishConfig: objectSchema
      .map(objectLoose<{ access?: NpmAccess }>({ access: enums(["public", "restricted"] as const).or(optional()) }))
      .or(optional()),
  }),
);

export function resolveNpmAccess(manifestText: string): NpmAccess {
  try {
    return accessSchema(JSON.parse(manifestText)).publishConfig?.access ?? "public";
  } catch (cause) {
    throw new Error("Invalid publishConfig.access: expected public or restricted", { cause });
  }
}
