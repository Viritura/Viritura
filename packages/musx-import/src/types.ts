export type DenigmaDiagnosticSeverity = "info" | "warning" | "error" | "verbose";

export interface DenigmaDiagnostic {
  severity: DenigmaDiagnosticSeverity;
  message: string;
}

export interface DenigmaGapPosition {
  numerator: number;
  denominator: number;
}

export interface DenigmaGapAnchor {
  anchor: string;
  staff?: number;
  position?: DenigmaGapPosition;
}

export interface DenigmaGap extends DenigmaGapAnchor {
  type: string;
  extent: "complete" | "partial";
  end?: DenigmaGapAnchor;
  placements?: Array<DenigmaGapAnchor & { kind: "staff" | "system-top" | "system-bottom" }>;
  [key: string]: unknown;
}

export interface DenigmaGapReport {
  schemaVersion: 1;
  producer: {
    name: string;
    version: string;
    commit: string;
  };
  gaps: DenigmaGap[];
  arrowheads?: Record<string, unknown>;
}

export type DenigmaGapDisposition = "handled" | "handled-partially" | "unhandled";

export interface DenigmaGapOutcome {
  gapIndex: number;
  type: string;
  subtype?: string;
  anchor: string;
  disposition: DenigmaGapDisposition;
  reason?: string;
}

export interface MusxImportOptions {
  includeTempoTool?: boolean;
  splitInstruments?: boolean;
  indentSpaces?: number;
  cueLayer?: number;
  /** Conversion timeout, capped at the package's 120-second safety maximum. */
  timeoutMs?: number;
}

export interface MusxImportResult {
  mnxJson: string;
  gapReport: DenigmaGapReport;
  gapOutcomes: DenigmaGapOutcome[];
  diagnostics: DenigmaDiagnostic[];
  denigmaVersion: string;
  denigmaCommit: string;
}

export interface DenigmaWorkerRequest {
  type: "convert";
  requestId: number;
  sourceName: string;
  buffer: ArrayBuffer;
  options: MusxImportOptions;
}

interface DenigmaWorkerSuccess {
  type: "converted";
  requestId: number;
  result: MusxImportResult;
}

export interface DenigmaWorkerFailure {
  type: "conversion-error";
  requestId: number;
  message: string;
  diagnostics: DenigmaDiagnostic[];
}

export type DenigmaWorkerResponse = DenigmaWorkerSuccess | DenigmaWorkerFailure;
