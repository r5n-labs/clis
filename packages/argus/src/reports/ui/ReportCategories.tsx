import type { MouseEvent } from "react";
import { useCallback, useMemo } from "react";
import type { Filters, Result } from "./select-results";
import { label } from "./select-results";

export function ReportCategories({
  results,
  total,
  selected,
  onChange,
}: {
  results: Result[];
  total: number;
  selected: string;
  onChange: (change: Partial<Filters>) => void;
}) {
  const categories = useMemo(() => countCategories(results), [results]);
  const selectCategory = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => onChange({ category: event.currentTarget.value }),
    [onChange],
  );

  return (
    <nav aria-label="Check categories" className="categories">
      <button aria-pressed={!selected} onClick={selectCategory} type="button" value="">
        All checks <span>{total.toLocaleString()}</span>
      </button>
      {categories.map((category) => (
        <button
          aria-pressed={selected === category.id}
          key={category.id}
          onClick={selectCategory}
          type="button"
          value={category.id}>
          {label(category.id)} <span>{category.count.toLocaleString()}</span>
        </button>
      ))}
    </nav>
  );
}

function countCategories(results: Result[]) {
  const counts = new Map<string, number>();
  for (const item of results) counts.set(item.question, (counts.get(item.question) ?? 0) + 1);
  return [...counts.keys()].sort().map((id) => ({ id, count: counts.get(id) ?? 0 }));
}
