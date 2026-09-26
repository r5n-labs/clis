import { basename } from "node:path";
import { select, text } from "@r5n/cli-core";
import type { ReviewSnapshotStore } from "../verification/ReviewSnapshotStore";

const MANUAL_PATH = "__manual__";

export async function promptVerdictFile(snapshots: ReviewSnapshotStore): Promise<string> {
  const templates = snapshots.templates();
  const selected = await select({
    message: "Verdict file to import",
    options: [
      ...templates.map(({ path, modified, progress }) => {
        const status = progress
          ? `${progress.completed}/${progress.total} completed`
          : "Invalid or incomplete template";
        return {
          value: path,
          label: `Modified ${new Date(modified).toLocaleString("en-GB")} · ${status}`,
          hint: basename(path),
        };
      }),
      { value: MANUAL_PATH, label: "Enter a file path", hint: "Import verdicts saved elsewhere" },
    ],
  });
  if (selected !== MANUAL_PATH) return selected;
  return (
    await text({ message: "Verdict JSON path", validate: (value) => (value?.trim() ? undefined : "Enter a file path") })
  ).trim();
}
