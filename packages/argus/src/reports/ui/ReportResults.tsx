import { useMemo } from "react";
import type { Report } from "../report-data";
import { CopyReview } from "./CopyReview";
import { ReportCategories } from "./ReportCategories";
import { ReportFilters } from "./ReportFilters";
import { ReportPagination } from "./ReportPagination";
import { ResultsTable } from "./ResultsTable";
import { label } from "./select-results";
import type { ReportView } from "./use-report-view";

export function ReportResults({ report, view }: { report: Report; view: ReportView }) {
  const { filters, sort, filteredResults, reset, updateFilters } = view;
  const groups = useMemo(() => [...new Set(report.results.map((item) => item.group))].sort(), [report.results]);
  const answers = useMemo(
    () =>
      [...new Set(report.results.flatMap((item) => (item.evaluation ? [item.evaluation.answer.choice] : [])))].sort(),
    [report.results],
  );

  return (
    <section aria-label="Review results" className="results-panel">
      <div className="panel-heading">
        <div>
          <h2>Review results</h2>
          <p>
            {report.summary.questions.toLocaleString()} checks across {report.summary.targets.toLocaleString()} targets
            in {report.summary.files.toLocaleString()} files
          </p>
          {report.verificationSummary.total > 0 && (
            <p>
              Verified: {report.verificationSummary.confirmed} confirmed · {report.verificationSummary.falsePositives}{" "}
              false positives · {report.verificationSummary.deferred} deferred · {report.verificationSummary.uncertain}{" "}
              uncertain
            </p>
          )}
        </div>
        <CopyReview label="Copy candidates for LLM" report={report} />
        <CopyReview label="Copy filtered checks" report={report} results={filteredResults} />
        <button className="reset-button" onClick={reset} type="button">
          Reset view <span aria-hidden="true">↺</span>
        </button>
      </div>
      <ReportCategories
        onChange={updateFilters}
        results={report.results}
        selected={filters.category}
        total={report.summary.questions}
      />
      <ReportFilters answers={answers} filters={filters} groups={groups} onChange={updateFilters} />
      <div aria-live="polite" className="results-count" role="status">
        <span>
          {filteredResults.length.toLocaleString()} matching checks{view.isSearchPending ? " · Updating…" : ""}
        </span>
        <span>
          {sort.key === "priority"
            ? "Needs review first"
            : `Sorted by ${label(sort.key).toLowerCase()} · ${sort.direction === "asc" ? "ascending" : "descending"}`}
        </span>
      </div>
      {filteredResults.length ? (
        <ResultsTable
          contexts={report.contexts}
          onSort={view.sortBy}
          report={report}
          results={view.visibleResults}
          sort={sort}
        />
      ) : (
        <EmptyResults hasChecks={report.results.length > 0} onReset={reset} />
      )}
      <ReportPagination
        onChange={view.setPage}
        page={view.currentPage}
        pageCount={view.pageCount}
        resultCount={filteredResults.length}
      />
    </section>
  );
}

function EmptyResults({ hasChecks, onReset }: { hasChecks: boolean; onReset: () => void }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">◎</span>
      <h3>{hasChecks ? "No matching checks" : "No checks in this report"}</h3>
      <p>
        {hasChecks
          ? "Try a different search or clear the filters."
          : "Add review questions to your Argus configuration to get started."}
      </p>
      {hasChecks ? (
        <button className="reset-button" onClick={onReset} type="button">
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
