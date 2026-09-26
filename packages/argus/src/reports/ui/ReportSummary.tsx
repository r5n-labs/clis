import type { MouseEvent } from "react";
import { useCallback } from "react";
import type { Report } from "../report-data";
import type { Filters, StatusFilter } from "./select-results";

const SUMMARY_CARDS: {
  status: StatusFilter;
  field: "needsReview" | "checked" | "pending" | "blocked";
  title: string;
  description: string;
  icon: string;
}[] = [
  {
    status: "review",
    field: "needsReview",
    title: "Needs review",
    description: "Outstanding findings and context checks",
    icon: "↗",
  },
  { status: "checked", field: "checked", title: "Checked", description: "Saved evaluations available", icon: "✓" },
  { status: "pending", field: "pending", title: "Pending", description: "Waiting for an evaluation", icon: "◷" },
  {
    status: "blocked",
    field: "blocked",
    title: "Blocked",
    description: "Context exceeds the request limit",
    icon: "⊘",
  },
];

export function ReportSummary({
  summary,
  needsReview,
  status,
  onChange,
}: {
  summary: Report["summary"];
  needsReview: number;
  status: StatusFilter;
  onChange: (change: Partial<Filters>) => void;
}) {
  const selectStatus = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const card = SUMMARY_CARDS.find((item) => item.status === event.currentTarget.value);
      if (card) onChange({ status: card.status });
    },
    [onChange],
  );

  return (
    <section aria-label="Review summary" className="summary-grid">
      {SUMMARY_CARDS.map((card) => (
        <button
          aria-pressed={status === card.status}
          className={`summary-card summary-${card.status === "review" ? "flagged" : card.status}`}
          key={card.status}
          onClick={selectStatus}
          type="button"
          value={card.status}>
          <span>
            {card.title}
            <span aria-hidden="true">{card.icon}</span>
          </span>
          <strong>{(card.field === "needsReview" ? needsReview : summary[card.field]).toLocaleString()}</strong>
          <small>{card.description}</small>
        </button>
      ))}
    </section>
  );
}
