import type { MouseEvent } from "react";
import { useCallback } from "react";
import { PAGE_SIZE } from "./select-results";

export function ReportPagination({
  page,
  pageCount,
  resultCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  resultCount: number;
  onChange: (page: number) => void;
}) {
  const offset = page * PAGE_SIZE;
  const first = (offset + 1).toLocaleString();
  const last = Math.min(offset + PAGE_SIZE, resultCount).toLocaleString();
  const changePage = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => onChange(page + Number(event.currentTarget.value)),
    [page, onChange],
  );

  return (
    <footer className="pagination">
      <span>{resultCount ? `${first}–${last} of ${resultCount.toLocaleString()}` : "0 results"}</span>
      <div className="pagination-controls">
        <button disabled={page === 0} onClick={changePage} type="button" value="-1">
          ← Previous
        </button>
        <span>
          Page {page + 1} of {pageCount}
        </span>
        <button disabled={page + 1 >= pageCount} onClick={changePage} type="button" value="1">
          Next →
        </button>
      </div>
    </footer>
  );
}
