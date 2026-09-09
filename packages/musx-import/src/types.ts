export type DenigmaDiagnosticSeverity = "info" | "warning" | "error" | "verbose";

export interface DenigmaDiagnostic {
  severity: DenigmaDiagnosticSeverity;
  message: string;
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
