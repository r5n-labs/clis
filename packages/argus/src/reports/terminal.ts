import { reviewCandidates } from "./llm";
import { shellArgument } from "./llm-summary";
import type { Report } from "./report-data";

function summaryLines(report: Report): string[] {
  const { summary } = report;
  return [
    `${summary.files} files · ${summary.targets} targets · ${summary.questions} checks`,
    `${summary.checked} checked · ${summary.pending} pending · ${summary.blocked} blocked · ${summary.requests} requests needed · ${summary.flagged} flagged`,
  ];
}

export function runSummary(report: Report, options: { config: string; path: string; base?: string }): string {
  const command = [
    "argus",
    "report",
    "create",
    "--config",
    options.config,
    ...(options.base ? ["--base", options.base] : []),
  ];
  return [
    ...summaryLines(report),
    `${reviewCandidates(report).length} review candidates (unchanged settled verdicts excluded)`,
    `Report: ${options.path}`,
    `Review queue: ${command.map(shellArgument).join(" ")}`,
  ].join("\n");
}

export function terminalReport(report: Report, details = true): string {
  const lines = summaryLines(report);
  if (details)
    for (const item of report.results.filter((item) => item.flagged))
      lines.push(
        `${item.path}:${item.line}  ${item.target}  ${item.question}: ${item.evaluation?.answer.choice} (confidence ${item.evaluation?.answer.confidence})`,
      );
  for (const item of report.results.filter((item) => item.status === "blocked"))
    lines.push(`${item.path}:${item.line}  ${item.question}: ${item.reason}`);
  return lines.join("\n");
}
