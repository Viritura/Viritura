import type { DenigmaDiagnostic, DenigmaGap, DenigmaGapOutcome } from "../types";

export type JsonRecord = Record<string, unknown>;

export interface GapAdaptationResult {
  mnxJson: string;
  outcomes: DenigmaGapOutcome[];
  diagnostics: DenigmaDiagnostic[];
}

export interface GapApplication {
  outcome: Omit<DenigmaGapOutcome, "gapIndex" | "type" | "anchor">;
}

interface FormattedText {
  plain: string;
  runs?: Array<{
    text: string;
    glyphs?: string[];
    insert?: { kind: string; command: string; parameters?: string[] };
  }>;
}

export interface ExpressionPayload {
  type: string;
  scope?: string;
  text?: FormattedText;
  genericText?: { text: string };
  technique?: { type: string; text: string };
  rehearsalMark?: { text: string };
  tempo?: TempoPayload;
  tempoAlteration?: TempoPayload;
  metronome?: {
    tempo: TempoPayload;
    noteTypeEdu: number;
    noteGlyphName?: string;
    augmentationDots: number;
    displayedBeatsPerMinute: number;
  };
}

interface TempoPayload {
  text: string;
  beatsPerMinute: number;
  beatUnitEdu: number;
}

export interface GeneralLinePayload {
  lineStyle: string;
  lineVisible: boolean;
  lineWidth?: number;
  dashOn?: number;
  dashOff?: number;
  lineChar?: { codePoint: number; glyph?: string; font?: unknown };
  horizontal?: boolean;
  startCap?: { type?: string };
  endCap?: { type?: string };
  startText?: FormattedText;
  continuationText?: FormattedText;
  endText?: FormattedText;
  centerFullText?: FormattedText;
  centerAbbrText?: FormattedText;
}

interface SmartShapePayload {
  shapeType: string;
  kind: string;
  glissando?: { line: GeneralLinePayload };
  trillLine?: { includesTrSymbol: boolean; line?: GeneralLinePayload };
}

export interface KnownExpressionGap extends DenigmaGap {
  type: "expression";
  expression: ExpressionPayload;
}

export interface KnownSmartShapeGap extends DenigmaGap {
  type: "smart-shape";
  smartShape: SmartShapePayload;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextPayload(value: unknown): value is { text: string } {
  return isRecord(value) && typeof value["text"] === "string";
}

function isTempoPayload(value: unknown): value is TempoPayload {
  return (
    isRecord(value) &&
    typeof value["text"] === "string" &&
    typeof value["beatsPerMinute"] === "number" &&
    typeof value["beatUnitEdu"] === "number"
  );
}

export function isExpressionGap(gap: DenigmaGap): gap is KnownExpressionGap {
  if (gap.type !== "expression" || !isRecord(gap["expression"])) return false;
  const expression = gap["expression"];
  if (typeof expression["type"] !== "string") return false;
  switch (expression["type"]) {
    case "generic-text":
      return isTextPayload(expression["genericText"]);
    case "technique-text":
      return isRecord(expression["technique"]) && isTextPayload(expression["technique"]);
    case "rehearsal-mark":
      return isTextPayload(expression["rehearsalMark"]);
    case "tempo-mark":
      return isTempoPayload(expression["tempo"]);
    case "tempo-alteration":
      return isTempoPayload(expression["tempoAlteration"]);
    case "metronome-mark":
      return isRecord(expression["metronome"]) && isTempoPayload(expression["metronome"]["tempo"]);
    default:
      return true;
  }
}

export function isSmartShapeGap(gap: DenigmaGap): gap is KnownSmartShapeGap {
  if (gap.type !== "smart-shape" || !isRecord(gap["smartShape"])) return false;
  const smartShape = gap["smartShape"];
  if (typeof smartShape["shapeType"] !== "string" || typeof smartShape["kind"] !== "string") return false;
  if (smartShape["kind"] === "glissando") {
    return isRecord(smartShape["glissando"]) && isRecord(smartShape["glissando"]["line"]);
  }
  if (smartShape["kind"] === "trill-line") {
    return isRecord(smartShape["trillLine"]) && typeof smartShape["trillLine"]["includesTrSymbol"] === "boolean";
  }
  return true;
}
