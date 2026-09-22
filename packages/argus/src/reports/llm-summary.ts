import type { Report } from "./report-data";

type SummaryOptions = {
  candidates: Report["results"];
  batches: number;
  config: string;
  base?: string;
  includeVerified: boolean;
};

export function llmSummary(report: Report, options: SummaryOptions): string {
  const { candidates } = options;
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.question, (counts.get(candidate.question) ?? 0) + 1);
  const lines = [
    "Argus LLM review summary",
    `${report.summary.checked} checked · ${report.summary.pending} pending · ${report.summary.blocked} blocked`,
    `${candidates.length} candidates · ${candidates.length ? options.batches : 0} batches`,
  ];
  if (!candidates.length)
    return [...lines, "No review candidates in this selection. Use --include-verified to revisit saved verdicts."].join(
      "\n",
    );
  for (const [question, count] of [...counts].sort(([a], [b]) => a.localeCompare(b)))
    lines.push(`${question}: ${count}`);
  const command = [
    "argus",
    "report",
    "--llm",
    "--config",
    options.config,
    ...(options.base === undefined ? [] : ["--base", options.base]),
    ...(options.includeVerified ? ["--include-verified"] : []),
  ]
    .map(shellArgument)
    .join(" ");
  return [
    ...lines,
    "",
    "Fetch one batch at a time:",
    `${command} --batch 1`,
    `Batch numbers: 1–${options.batches}. Each batch contains complete checks and their evidence.`,
    "",
    "Fetch the complete handoff:",
    command,
    "Batch numbers reflect the current source, configuration and saved results; rerun this summary if they change.",
  ].join("\n");
}

function shellArgument(value: string): string {
  return /^[\w./:=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
