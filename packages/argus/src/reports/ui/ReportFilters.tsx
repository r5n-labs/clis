import type { ChangeEvent } from "react";
import { useCallback } from "react";
import type { Filters, StatusFilter } from "./select-results";
import { label, PERCENT } from "./select-results";

const STATUS_OPTIONS: { value: StatusFilter; title: string }[] = [
  { value: "all", title: "All statuses" },
  { value: "review", title: "Needs review" },
  { value: "flagged", title: "Flagged" },
  { value: "checked", title: "Checked" },
  { value: "pending", title: "Pending" },
  { value: "blocked", title: "Blocked" },
];

export function ReportFilters({
  filters,
  groups,
  answers,
  onChange,
}: {
  filters: Filters;
  groups: string[];
  answers: string[];
  onChange: (change: Partial<Filters>) => void;
}) {
  const changeFilter = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name, value } = event.currentTarget;
      if (name === "confidence") {
        onChange({ minConfidence: Math.max(0, Math.min(PERCENT, Number(value) || 0)) / PERCENT });
        return;
      }
      if (name === "status") {
        const status = STATUS_OPTIONS.find((option) => option.value === value);
        if (status) onChange({ status: status.value });
        return;
      }
      if (name === "search" || name === "group" || name === "answer") onChange({ [name]: value });
    },
    [onChange],
  );
  return (
    <div className="filters">
      <label className="search-field">
        <span className="sr-only">Search results</span>
        <span aria-hidden="true">⌕</span>
        <input
          name="search"
          onChange={changeFilter}
          placeholder="Search methods, files or results…"
          type="search"
          value={filters.search}
        />
      </label>
      <label>
        <span className="sr-only">Status</span>
        <select aria-label="Status" name="status" onChange={changeFilter} value={filters.status}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Target type</span>
        <select aria-label="Target type" name="group" onChange={changeFilter} value={filters.group}>
          <option value="">All target types</option>
          {groups.map((group) => (
            <option key={group} value={group}>
              {label(group)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Result</span>
        <select aria-label="Result" name="answer" onChange={changeFilter} value={filters.answer}>
          <option value="">All results</option>
          {answers.map((answer) => (
            <option key={answer} value={answer}>
              {label(answer)}
            </option>
          ))}
        </select>
      </label>
      <label className="confidence-filter">
        Min. confidence
        <input
          aria-label="Minimum confidence percent"
          max={PERCENT}
          min={0}
          name="confidence"
          onChange={changeFilter}
          type="number"
          value={Math.round(filters.minConfidence * PERCENT)}
        />
        <span>%</span>
      </label>
    </div>
  );
}
