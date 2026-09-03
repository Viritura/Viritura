export type SupportStatus = "S" | "P" | "N" | "NA" | "?";
export type CoverageSurface = "mnx" | "musicxml" | "viritura-mnx" | "viritura-mxl";
export type PartialKind = "Subset" | "Approximation" | "Lossy" | "Extension required" | "Fixed style" | "Semantic gap";

export interface CoverageSummary {
  supported: number;
  partial: number;
  unsupported: number;
  notApplicable: number;
  unknown: number;
}

export interface PartialReason {
  kind: PartialKind;
  text: string;
}

export interface CoverageRow {
  group: string;
  subgroup: string;
  concept: string;
  id: string;
  mnx: SupportStatus;
  musicXml: SupportStatus;
  virituraMnx: SupportStatus;
  virituraMxl: SupportStatus;
  partialReasons: {
    virituraMnx?: PartialReason;
    virituraMxl?: PartialReason;
  };
}

export interface CoverageAudit {
  snapshot: string;
  findings: readonly string[];
  rows: readonly CoverageRow[];
  groups: readonly string[];
  summaries: {
    mnx: CoverageSummary;
    musicXml: CoverageSummary;
    virituraMnx: CoverageSummary;
    virituraMxl: CoverageSummary;
  };
}

export interface CoverageFilters {
  query: string;
  surface: CoverageSurface;
  status: SupportStatus | "all";
}

export const DEFAULT_COVERAGE_FILTERS: CoverageFilters = {
  query: "",
  surface: "viritura-mnx",
  status: "all",
};

export const STATUS_LABELS: Readonly<Record<SupportStatus, string>> = {
  S: "Supported",
  P: "Partial",
  N: "Unsupported",
  NA: "Derived",
  "?": "Unknown",
};

export function summarizeStatuses(statuses: readonly SupportStatus[]): CoverageSummary {
  const summary: CoverageSummary = {
    supported: 0,
    partial: 0,
    unsupported: 0,
    notApplicable: 0,
    unknown: 0,
  };
  for (const status of statuses) {
    if (status === "S") summary.supported += 1;
    else if (status === "P") summary.partial += 1;
    else if (status === "N") summary.unsupported += 1;
    else if (status === "NA") summary.notApplicable += 1;
    else summary.unknown += 1;
  }
  return summary;
}

export function statusForSurface(row: CoverageRow, surface: CoverageSurface): SupportStatus {
  if (surface === "mnx") return row.mnx;
  if (surface === "musicxml") return row.musicXml;
  if (surface === "viritura-mxl") return row.virituraMxl;
  return row.virituraMnx;
}

export function partialReasonForSurface(row: CoverageRow, surface: CoverageSurface): PartialReason | undefined {
  if (surface === "viritura-mnx") return row.partialReasons.virituraMnx;
  if (surface === "viritura-mxl") return row.partialReasons.virituraMxl;
  return undefined;
}

export function filterCoverageRows(rows: readonly CoverageRow[], filters: CoverageFilters): readonly CoverageRow[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filters.status !== "all" && statusForSurface(row, filters.surface) !== filters.status) return false;
    if (!query) return true;
    const reasons = [row.partialReasons.virituraMnx?.text ?? "", row.partialReasons.virituraMxl?.text ?? ""];
    return [row.concept, row.id, row.group, row.subgroup, ...reasons].some((value) =>
      value.toLocaleLowerCase().includes(query),
    );
  });
}
