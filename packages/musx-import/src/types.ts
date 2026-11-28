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

export interface DenigmaGap {
  anchor?: string;
  staff?: number;
  position?: DenigmaGapPosition;
  type: string;
  extent: "complete" | "partial";
  [key: string]: unknown;
}

export interface DenigmaGapFont {
  name?: string;
  size?: number;
  sizeIsPercent?: boolean;
  absolute?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikeout?: boolean;
  hidden?: boolean;
  isSymbolFont?: boolean;
  isSmufl?: boolean;
}

export interface DenigmaGapReport {
  schemaVersion: 4;
  producer: {
    name: string;
    version: string;
    commit: string;
  };
  gaps: DenigmaGap[];
  fonts?: Record<string, DenigmaGapFont>;
  fretboards?: Record<string, DenigmaFretboardPayload>;
  leadingBlankPageSlots?: number;
  arrowheads?: Record<string, unknown>;
}

export type DenigmaFretboardPayload =
  | { kind: "font" }
  | {
      kind: "diagram";
      strings: number;
      frets: number;
      fretboardNumber: number;
      showFretboardNumber: boolean;
      fretNumberText?: string;
      cells: DenigmaFretboardCell[];
      barres: DenigmaFretboardBarre[];
    };

interface DenigmaFretboardCell {
  string: number;
  fret: number;
  shape: "closed" | "open" | "muted" | "custom" | "none";
  finger?: number;
}

interface DenigmaFretboardBarre {
  fret: number;
  startString: number;
  endString: number;
}

export function isDenigmaFretboardPayload(value: unknown): value is DenigmaFretboardPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record["kind"] === "font") return true;
  return (
    record["kind"] === "diagram" &&
    Number.isSafeInteger(record["strings"]) &&
    Number.isSafeInteger(record["frets"]) &&
    Number.isSafeInteger(record["fretboardNumber"]) &&
    typeof record["showFretboardNumber"] === "boolean" &&
    (record["fretNumberText"] === undefined || typeof record["fretNumberText"] === "string") &&
    Array.isArray(record["cells"]) &&
    record["cells"].every((cell) => {
      if (typeof cell !== "object" || cell === null || Array.isArray(cell)) return false;
      const item = cell as Record<string, unknown>;
      return (
        Number.isSafeInteger(item["string"]) &&
        Number.isSafeInteger(item["fret"]) &&
        ["closed", "open", "muted", "custom", "none"].includes(String(item["shape"])) &&
        (item["finger"] === undefined || Number.isSafeInteger(item["finger"]))
      );
    }) &&
    Array.isArray(record["barres"]) &&
    record["barres"].every((barre) => {
      if (typeof barre !== "object" || barre === null || Array.isArray(barre)) return false;
      const item = barre as Record<string, unknown>;
      return (
        Number.isSafeInteger(item["fret"]) &&
        Number.isSafeInteger(item["startString"]) &&
        Number.isSafeInteger(item["endString"])
      );
    })
  );
}

export function hasKnownFretboardReferences(value: unknown, fretboards: Record<string, unknown>): boolean {
  if (Array.isArray(value)) return value.every((item) => hasKnownFretboardReferences(item, fretboards));
  if (typeof value !== "object" || value === null) return true;
  return Object.entries(value).every(([key, child]) => {
    if (key === "fretboard") return typeof child === "string" && isRecord(fretboards[child]);
    return hasKnownFretboardReferences(child, fretboards);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type DenigmaGapDisposition = "handled" | "handled-partially" | "unhandled";

export interface DenigmaGapOutcome {
  gapIndex: number;
  type: string;
  subtype?: string;
  anchor?: string;
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
