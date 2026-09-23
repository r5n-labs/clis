import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type ArgDefinition, args, Exit, positionals, validateKnownArgs } from "@r5n/cli-core";
import { loadConfig } from "../../config/loader";
import { parseReviewQueue } from "../../config/validation";
import { JSON_INDENT } from "../../constants";
import { htmlReport } from "../../reports/html";
import { ReviewCatalogue } from "../../reports/ReviewCatalogue";
import type { Report } from "../../reports/report-data";
import { ReviewSnapshotStore, type TemplateSelection } from "../../verification/ReviewSnapshotStore";

export const snapshotArgs = args({
  config: { type: "string", description: "Path to Argus configuration" },
  snapshot: { type: "string", description: "Saved snapshot ID (defaults to latest)" },
});
export const selectionArgs = args({
  ...snapshotArgs,
  queue: { type: "string", description: "findings, context or documentation (default: all)" },
  "include-verified": {
    type: "boolean",
    default: false,
    description: "Include candidates settled when this snapshot was created",
  },
});
export const noPositionals = positionals({ extra: { variadic: true } });
export const idPositionals = positionals({
  id: { description: "Full review or evidence ID (omit to choose interactively)" },
  extra: { variadic: true },
});

type SnapshotOptions = { config?: string; snapshot?: string; "include-verified"?: boolean };

export function openSnapshot(options: SnapshotOptions, selection?: TemplateSelection) {
  const loaded = loadConfig(options.config);
  const snapshots = new ReviewSnapshotStore(loaded);
  const report = snapshots.read(options.snapshot);
  snapshots.saveTemplate(report, selection ?? (options["include-verified"] ? "all-candidates" : "candidates"));
  return { loaded, report, catalogue: new ReviewCatalogue(report, options["include-verified"]) };
}

export function selectedQueue(value?: string) {
  return value === undefined ? undefined : parseReviewQueue(value);
}

export function validateOptions(
  values: Record<string, unknown>,
  definitions: Record<string, ArgDefinition>,
  extra: string[],
): void {
  validateKnownArgs(values, definitions, "Run 'argus report --help'");
  if (extra.length) throw new Exit(`Unexpected arguments: ${extra.join(" ")}`);
  for (const key of ["config", "snapshot"])
    if (values[key] !== undefined && (typeof values[key] !== "string" || !values[key].trim()))
      throw new Exit(`--${key} requires a value`);
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, JSON_INDENT));
}

export async function writeHtml(report: Report, stateDir: string, destination?: string): Promise<void> {
  const path = destination
    ? resolve(destination)
    : join(stateDir, "reports", `${new Date().toISOString().replaceAll(":", "-")}.html`);
  const html = await htmlReport(report);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, html, { flag: "wx" });
  } catch {
    throw new Exit(`Cannot create report: ${path}`, "Choose an unused file path and check directory permissions");
  }
  console.log(`Report: ${path}`);
}
