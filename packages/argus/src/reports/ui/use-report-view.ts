import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { Filters, Result, Sort, SortKey } from "./select-results";
import { DEFAULT_FILTERS, DEFAULT_SORT, PAGE_SIZE, selectResults } from "./select-results";

export function useReportView(results: Result[]) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [page, setPage] = useState(0);
  const deferredSearch = useDeferredValue(filters.search);
  const filteredResults = useMemo(
    () => selectResults(results, { ...filters, search: deferredSearch }, sort),
    [results, filters, deferredSearch, sort],
  );
  const pageCount = Math.max(1, Math.ceil(filteredResults.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const offset = currentPage * PAGE_SIZE;

  const updateFilters = useCallback((change: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...change }));
    setPage(0);
  }, []);
  const reset = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSort(DEFAULT_SORT);
    setPage(0);
  }, []);
  const sortBy = useCallback((key: SortKey) => {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
    setPage(0);
  }, []);

  return {
    filters,
    sort,
    currentPage,
    pageCount,
    filteredResults,
    visibleResults: filteredResults.slice(offset, offset + PAGE_SIZE),
    isSearchPending: filters.search !== deferredSearch,
    updateFilters,
    reset,
    sortBy,
    setPage,
  };
}

export type ReportView = ReturnType<typeof useReportView>;
