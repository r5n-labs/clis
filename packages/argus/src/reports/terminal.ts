import type { Report } from "./report-data";

export function terminalReport(report: Report, details = true): string {
  const { summary } = report;
  const lines = [
    `${summary.files} files · ${summary.targets} targets · ${summary.questions} checks`,
    `${summary.checked} checked · ${summary.pending} pending · ${summary.blocked} blocked · ${summary.requests} requests needed · ${summary.flagged} flagged`,
  ];
  if (details)
    for (const item of report.results.filter((item) => item.flagged))
      lines.push(
        `${item.path}:${item.line}  ${item.target}  ${item.question}: ${item.evaluation?.answer.choice} (confidence ${item.evaluation?.answer.confidence})`,
      );
  for (const item of report.results.filter((item) => item.status === "blocked"))
    lines.push(`${item.path}:${item.line}  ${item.question}: ${item.reason}`);
  return lines.join("\n");
}
