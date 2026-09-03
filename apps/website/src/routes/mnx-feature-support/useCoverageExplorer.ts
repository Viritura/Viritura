import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { coverageAudit } from "./coverageData";
import { DEFAULT_COVERAGE_FILTERS, filterCoverageRows, type CoverageFilters, type CoverageRow } from "./coverageModel";

export interface GroupedCoverageRows {
  group: string;
  rows: readonly CoverageRow[];
}

const COVERAGE_HASH_EVENT = "viritura:coverage-hash";

function subscribeToHash(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  window.addEventListener("hashchange", callback);
  window.addEventListener(COVERAGE_HASH_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("hashchange", callback);
    window.removeEventListener(COVERAGE_HASH_EVENT, callback);
  };
}

function currentHash(): string {
  return window.location.hash;
}

function serverHash(): string {
  return "";
}

function normalizeFilters(filters: CoverageFilters): CoverageFilters {
  return filters.surface !== "viritura-mxl" && filters.status === "NA" ? { ...filters, status: "all" } : filters;
}

function clearSelectedConcept(): void {
  if (!window.location.hash) return;
  window.history.replaceState(null, "", window.location.pathname);
  window.dispatchEvent(new Event(COVERAGE_HASH_EVENT));
}

export function useCoverageExplorer() {
  const hash = useSyncExternalStore(subscribeToHash, currentHash, serverHash);
  const [filters, setFilters] = useState<CoverageFilters>(DEFAULT_COVERAGE_FILTERS);
  const rows = useMemo(() => filterCoverageRows(coverageAudit.rows, filters), [filters]);
  const groupedRows = useMemo(
    () =>
      coverageAudit.groups
        .map((group) => ({ group, rows: rows.filter((row) => row.group === group) }))
        .filter((entry) => entry.rows.length > 0),
    [rows],
  );
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const handledHash = useRef("");
  const autoOpenedFilter = useRef("");

  useEffect(() => {
    if (!window.location.search) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
  }, []);

  useEffect(() => {
    const targetId = hash.slice(1);
    if (!targetId || targetId === handledHash.current) return;
    const targetRow = coverageAudit.rows.find((row) => row.id === targetId);
    if (!targetRow) return;
    let scrollTimer: number | undefined;
    const openTimer = window.setTimeout(() => {
      handledHash.current = targetId;
      setOpenGroups((current) => new Set([...current, targetRow.group]));
      scrollTimer = window.setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ block: "center" }), 0);
    }, 0);
    return () => {
      window.clearTimeout(openTimer);
      if (scrollTimer !== undefined) window.clearTimeout(scrollTimer);
    };
  }, [hash]);

  useEffect(() => {
    const filterKey =
      filters.query.trim() || filters.status !== "all" || filters.surface !== DEFAULT_COVERAGE_FILTERS.surface
        ? `${filters.query}\u0000${filters.surface}\u0000${filters.status}`
        : "";
    if (!filterKey || groupedRows.length !== 1 || autoOpenedFilter.current === filterKey) return;
    const group = groupedRows[0]!.group;
    const timer = window.setTimeout(() => {
      autoOpenedFilter.current = filterKey;
      setOpenGroups((current) => new Set([...current, group]));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [filters, groupedRows]);

  const updateFilter = <K extends keyof CoverageFilters>(key: K, value: CoverageFilters[K]) => {
    clearSelectedConcept();
    setFilters((current) => normalizeFilters({ ...current, [key]: value }));
  };
  const setGroupOpen = (group: string, open: boolean) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (open) next.add(group);
      else next.delete(group);
      return next;
    });
  };

  return {
    filters,
    rows,
    groupedRows,
    openGroups,
    updateFilter,
    setGroupOpen,
    resetFilters: () => {
      clearSelectedConcept();
      setFilters(DEFAULT_COVERAGE_FILTERS);
    },
    expandAll: () => setOpenGroups(new Set(groupedRows.map((entry) => entry.group))),
    collapseAll: () => setOpenGroups(new Set()),
  };
}
