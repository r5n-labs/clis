import type { MouseEvent } from "react";
import { Fragment, useCallback, useState } from "react";
import { isReviewCandidate } from "../candidates";
import type { Report } from "../report-data";
import { ResultDetails } from "./ResultDetails";
import type { Result, Sort, SortKey } from "./select-results";
import { confidence, label, resultKey } from "./select-results";

const COLUMNS: { key: SortKey; title: string }[] = [
  { key: "target", title: "Target" },
  { key: "path", title: "Location" },
  { key: "question", title: "Check" },
  { key: "answer", title: "Result" },
  { key: "confidence", title: "Confidence" },
  { key: "status", title: "Status" },
];
const COLUMN_COUNT = 7;

export function ResultsTable({
  results,
  sort,
  onSort,
  contexts,
  report,
}: {
  results: Result[];
  sort: Sort;
  onSort: (key: SortKey) => void;
  contexts?: Report["contexts"];
  report?: Report;
}) {
  const [expanded, setExpanded] = useState<string | undefined>();
  const sortColumn = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const column = COLUMNS.find((item) => item.key === event.currentTarget.value);
      if (column) onSort(column.key);
    },
    [onSort],
  );
  const toggleDetails = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const key = event.currentTarget.value;
    setExpanded((current) => (current === key ? undefined : key));
  }, []);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                aria-sort={sort.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                key={column.key}
                scope="col">
                <button onClick={sortColumn} type="button" value={column.key}>
                  {column.title}
                  <span aria-hidden="true" className="sort-indicator">
                    {sort.key === column.key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                  </span>
                </button>
              </th>
            ))}
            <th scope="col">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map((item) => {
            const key = resultKey(item);
            const open = expanded === key;
            const answer = item.evaluation?.answer;
            const needsReview = isReviewCandidate(item, report?.questions ?? {});
            return (
              <Fragment key={key}>
                <tr className={open ? "expanded-row" : undefined}>
                  <td className="target-cell">
                    <code>{item.target}</code>
                    <span className="target-group">{label(item.group)}</span>
                  </td>
                  <td className="path-cell">
                    <span>{item.path}</span>
                    <small>Line {item.line}</small>
                  </td>
                  <td>{label(item.question)}</td>
                  <td>
                    <span className={`answer ${item.flagged ? "answer-flagged" : ""}`}>
                      {answer ? label(answer.choice) : "—"}
                    </span>
                  </td>
                  <td className="confidence-cell">{confidence(answer?.confidence)}</td>
                  <td>
                    <span className={`status status-${needsReview ? "flagged" : item.status}`}>
                      <span aria-hidden="true" />
                      {item.verification
                        ? label(item.verification.verdict)
                        : needsReview
                          ? "Needs review"
                          : label(item.status)}
                    </span>
                  </td>
                  <td>
                    <button
                      aria-expanded={open}
                      aria-label={`Details for ${item.target}, ${item.question}`}
                      className="expand-button"
                      onClick={toggleDetails}
                      type="button"
                      value={key}>
                      {open ? "−" : "+"}
                    </button>
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td className="detail-cell" colSpan={COLUMN_COUNT}>
                      <ResultDetails
                        context={item.contextId ? contexts?.[item.contextId] : undefined}
                        item={item}
                        report={report}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
