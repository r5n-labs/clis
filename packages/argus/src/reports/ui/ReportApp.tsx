import { useId } from "react";
import type { Report } from "../report-data";
import { ReportResults } from "./ReportResults";
import { ReportSummary } from "./ReportSummary";
import { useReportView } from "./use-report-view";

export function ReportApp({ report }: { report: Report }) {
  const mainId = useId();
  const view = useReportView(report);
  const project = report.root.split(/[\\/]/).filter(Boolean).at(-1) ?? report.root;

  return (
    <div className="report-shell">
      <header className="topbar">
        <a aria-label="Argus report" className="brand" href={`#${mainId}`}>
          <span aria-hidden="true" className="brand-mark">
            ◉
          </span>
          ARGUS
          <span className="brand-divider" />
          REVIEW REPORT
        </a>
        <span className="snapshot-label">
          <span aria-hidden="true" />
          Offline snapshot
        </span>
      </header>
      <main id={mainId}>
        <section className="report-heading">
          <div>
            <p className="eyebrow">PROJECT REVIEW</p>
            <h1>{project}</h1>
            <p className="project-path">{report.root}</p>
          </div>
          <div className="report-metadata">
            <span>{report.model}</span>
            <time dateTime={report.generatedAt}>{new Date(report.generatedAt).toLocaleString()}</time>
          </div>
        </section>
        <ReportSummary
          needsReview={view.needsReview}
          onChange={view.updateFilters}
          status={view.filters.status}
          summary={report.summary}
        />
        <ReportResults report={report} view={view} />
        <footer className="report-footer">
          <span>
            ARGUS <span aria-hidden="true">/</span> Candidates for evidence-backed review
          </span>
          <span>Generated {new Date(report.generatedAt).toLocaleDateString()} · All data stays in this file</span>
        </footer>
      </main>
    </div>
  );
}
