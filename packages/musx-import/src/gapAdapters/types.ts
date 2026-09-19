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

interface ChordPitchPayload {
  step: string;
  alteration: number;
}

interface ChordSuffixPayload {
  strings: Array<{ text: string; position: "inline" | "above" | "below" }>;
  suffixText: string;
  degrees: Array<{
    value: number;
    alteration: number;
    type: "add" | "remove" | "alter";
    impliedByText: boolean;
  }>;
  parenthesizeDegrees: boolean;
  stackDegrees: boolean;
  hasOuterParentheses: boolean;
  hasUnrecognizedGlyphs: boolean;
  quality?: string;
}

export interface ChordPayload {
  root: ChordPitchPayload;
  rootLowerCase: boolean;
  showRoot: boolean;
  showSuffix: boolean;
  suffix: ChordSuffixPayload;
  bass?: ChordPitchPayload;
  bassLowerCase?: boolean;
  bassArrangement?: "horizontal" | "vertical" | "diagonal";
}

export interface NoteheadPayload {
  shape: string;
  fill: "unspecified" | "filled" | "unfilled";
  glyph?: string;
}

export interface KnownExpressionGap extends DenigmaGap {
  type: "expression";
  expression: ExpressionPayload;
}

export interface KnownSmartShapeGap extends DenigmaGap {
  type: "smart-shape";
  smartShape: SmartShapePayload;
}

export interface KnownChordGap extends DenigmaGap {
  type: "chord-symbol";
  chord: ChordPayload;
}

export interface KnownNoteheadGap extends DenigmaGap {
  type: "notehead";
  notehead: NoteheadPayload;
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

function isChordPitch(value: unknown): value is ChordPitchPayload {
  return isRecord(value) && typeof value["step"] === "string" && typeof value["alteration"] === "number";
}

export function isChordGap(gap: DenigmaGap): gap is KnownChordGap {
  if (gap.type !== "chord-symbol" || !isRecord(gap["chord"])) return false;
  const chord = gap["chord"];
  return (
    isChordPitch(chord["root"]) &&
    typeof chord["rootLowerCase"] === "boolean" &&
    typeof chord["showRoot"] === "boolean" &&
    typeof chord["showSuffix"] === "boolean" &&
    isRecord(chord["suffix"]) &&
    Array.isArray(chord["suffix"]["strings"]) &&
    typeof chord["suffix"]["suffixText"] === "string" &&
    Array.isArray(chord["suffix"]["degrees"]) &&
    typeof chord["suffix"]["parenthesizeDegrees"] === "boolean" &&
    typeof chord["suffix"]["stackDegrees"] === "boolean" &&
    typeof chord["suffix"]["hasOuterParentheses"] === "boolean" &&
    typeof chord["suffix"]["hasUnrecognizedGlyphs"] === "boolean" &&
    (chord["bass"] === undefined || isChordPitch(chord["bass"]))
  );
}

export function isNoteheadGap(gap: DenigmaGap): gap is KnownNoteheadGap {
  return (
    gap.type === "notehead" &&
    isRecord(gap["notehead"]) &&
    typeof gap["notehead"]["shape"] === "string" &&
    (gap["notehead"]["fill"] === "unspecified" ||
      gap["notehead"]["fill"] === "filled" ||
      gap["notehead"]["fill"] === "unfilled") &&
    (gap["notehead"]["glyph"] === undefined || typeof gap["notehead"]["glyph"] === "string")
  );
}
