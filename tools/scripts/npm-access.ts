import { enums, objectLoose, optional } from "banditypes";

type NpmAccess = "public" | "restricted";

const accessSchema = objectLoose<{ publishConfig?: { access?: NpmAccess } }>({
  publishConfig: objectLoose<{ access?: NpmAccess }>({
    access: enums(["public", "restricted"] as const).or(optional()),
  }).or(optional()),
});

export function resolveNpmAccess(manifestText: string): NpmAccess {
  try {
    return accessSchema(JSON.parse(manifestText)).publishConfig?.access ?? "public";
  } catch (cause) {
    throw new Error("Invalid publishConfig.access: expected public or restricted", { cause });
  }
}
