import type { DenigmaDiagnostic, DenigmaGap, DenigmaGapOutcome, DenigmaGapReport } from "../types";
import { applyChordSymbolGaps } from "./chordSymbols";
import {
  asDocumentRecord,
  ensureArrayProperty,
  ensureRecordProperty,
  ensureViritura,
  eventId,
  TargetIndex,
} from "./targetIndex";
import {
  isChordGap,
  isExpressionGap,
  isNoteheadGap,
  isRecord,
  isSmartShapeGap,
  type ExpressionPayload,
  type GapAdaptationResult,
  type GapApplication,
  type GeneralLinePayload,
  type JsonRecord,
  type NoteheadPayload,
} from "./types";

function subtypeOf(gap: DenigmaGap): string | undefined {
  if (isChordGap(gap)) return "chord-symbol";
  if (isNoteheadGap(gap)) return gap.notehead.shape;
  if (isExpressionGap(gap)) return gap.expression.type;
  if (isSmartShapeGap(gap)) return gap.smartShape.shapeType;
  return undefined;
}

const NOTEHEAD_GLYPH_MAP: Readonly<Record<string, "circleX" | "triangleUp" | "triangleDown">> = {
  noteheadCircleX: "circleX",
  noteheadCircleXBlack: "circleX",
  noteheadCircleXHalf: "circleX",
  noteheadCircleXWhole: "circleX",
  noteheadCircleXDoubleWhole: "circleX",
  noteheadTriangleUpBlack: "triangleUp",
  noteheadTriangleUpHalf: "triangleUp",
  noteheadTriangleUpWhole: "triangleUp",
  noteheadTriangleUpDoubleWhole: "triangleUp",
  noteheadTriangleDownBlack: "triangleDown",
  noteheadTriangleDownHalf: "triangleDown",
  noteheadTriangleDownWhole: "triangleDown",
  noteheadTriangleDownDoubleWhole: "triangleDown",
};

function tempoDisplayText(expression: ExpressionPayload): string | undefined {
  const runs = expression.text?.runs;
  const generatedIndex = runs?.findIndex(
    (run) => (run.glyphs?.length ?? 0) > 0 || run.insert?.kind === "playback-value",
  );
  if (runs && generatedIndex !== undefined && generatedIndex >= 0) {
    const prefix = runs
      .slice(0, generatedIndex)
      .map((run) => run.text)
      .join("")
      .trim()
      .replace(/[\s([{]+$/, "");
    return prefix || undefined;
  }
  return expression.type === "metronome-mark" ? undefined : expressionText(expression);
}

function hasVisibleMetronome(expression: ExpressionPayload): boolean {
  return (
    expression.type === "metronome-mark" ||
    expression.text?.runs?.some((run) => run.glyphs?.some((glyph) => glyph.startsWith("metNote"))) === true
  );
}

function outcome(disposition: DenigmaGapOutcome["disposition"], reason?: string): GapApplication {
  return { outcome: { disposition, ...(reason ? { reason } : {}) } };
}

function expressionText(expression: ExpressionPayload): string | undefined {
  const semantic =
    expression.genericText?.text ??
    expression.technique?.text ??
    expression.rehearsalMark?.text ??
    expression.tempo?.text ??
    expression.tempoAlteration?.text ??
    expression.metronome?.tempo.text;
  const text = semantic ?? expression.text?.plain;
  return text?.trim() || undefined;
}

function gapPosition(gap: DenigmaGap): JsonRecord {
  return { fraction: [gap.position?.numerator ?? 0, gap.position?.denominator ?? 1] };
}

function expressionPlacement(gap: DenigmaGap): "above" | "below" | undefined {
  if (gap.placements?.some((placement) => placement.kind === "system-bottom")) return "below";
  if (gap.placements?.some((placement) => placement.kind === "system-top")) return "above";
  return undefined;
}

function expressionMeasure(gap: DenigmaGap, index: TargetIndex) {
  const direct = index.measure(gap.anchor);
  if (direct?.partMeasure) return direct;
  const staffPlacement = gap.placements?.find((placement) => placement.kind === "staff");
  const placed = staffPlacement ? index.measure(staffPlacement.anchor) : undefined;
  if (placed?.partMeasure) return placed;
  return direct ? index.measure(`P1.m${direct.measureIndex + 1}`) : undefined;
}

function addTextExpression(gap: DenigmaGap, expression: ExpressionPayload, index: TargetIndex): GapApplication {
  const target = expressionMeasure(gap, index);
  const text = expressionText(expression);
  if (!target?.partMeasure || !text) return outcome("unhandled", "Expression target or plain text is unavailable.");
  const extensions = ensureViritura(target.partMeasure);
  const expressions = ensureArrayProperty(extensions, "expressions");
  const value: JsonRecord = { text, position: gapPosition(gap) };
  const placement = expressionPlacement(gap);
  if (placement) value["placement"] = placement;
  const staff = gap.staff ?? gap.placements?.find((candidate) => candidate.kind === "staff")?.staff;
  if (staff !== undefined) value["staff"] = staff;
  const duplicate = expressions.some(
    (candidate) =>
      isRecord(candidate) &&
      candidate["text"] === text &&
      JSON.stringify(candidate["position"]) === JSON.stringify(value["position"]) &&
      candidate["staff"] === value["staff"],
  );
  if (!duplicate) expressions.push(value);
  return outcome(
    expression.text?.plain !== undefined ? "handled-partially" : "handled",
    expression.text?.plain !== undefined ? "Flattened formatted text to plain text." : undefined,
  );
}

function addRehearsalMark(gap: DenigmaGap, expression: ExpressionPayload, index: TargetIndex): GapApplication {
  const target = index.measure(gap.anchor);
  const text = expressionText(expression);
  if (!target || !text) return outcome("unhandled", "Rehearsal-mark target or text is unavailable.");
  const extensions = ensureViritura(target.globalMeasure);
  if (extensions["rehearsalMark"] !== undefined) {
    return outcome(
      "handled-partially",
      "The measure already contains a rehearsal mark; the additional mark was omitted.",
    );
  }
  extensions["rehearsalMark"] = { text };
  return outcome(
    expression.text?.plain !== undefined ? "handled-partially" : "handled",
    expression.text?.plain !== undefined ? "Preserved plain text but not source formatting." : undefined,
  );
}

function noteValueFromEdu(edu: number): JsonRecord | undefined {
  const values: ReadonlyArray<readonly [number, string]> = [
    [8192, "breve"],
    [4096, "whole"],
    [2048, "half"],
    [1024, "quarter"],
    [512, "eighth"],
    [256, "16th"],
    [128, "32nd"],
    [64, "64th"],
    [32, "128th"],
    [16, "256th"],
    [8, "512th"],
    [4, "1024th"],
    [2, "2048th"],
    [1, "4096th"],
  ];
  const match = values.find(([candidate]) => candidate === edu);
  return match ? { base: match[1] } : undefined;
}

function tempoExtension(tempo: JsonRecord): JsonRecord {
  return ensureViritura(tempo);
}

function findOrCreateTempo(gap: DenigmaGap, expression: ExpressionPayload, index: TargetIndex): JsonRecord | undefined {
  const direct = index.byId(gap.anchor);
  if (direct && typeof direct["bpm"] === "number") return direct;
  const measure = index.measure(gap.anchor);
  const payload = expression.metronome?.tempo ?? expression.tempo;
  if (!measure || !payload || payload.beatsPerMinute <= 0) return undefined;
  const value = noteValueFromEdu(expression.metronome?.noteTypeEdu || payload.beatUnitEdu);
  if (!value) return undefined;
  const dots = expression.metronome?.augmentationDots;
  if (dots !== undefined && dots > 0) value["dots"] = dots;
  const tempo: JsonRecord = {
    bpm: payload.beatsPerMinute,
    value,
    location: gapPosition(gap),
  };
  const tempos = ensureArrayProperty(measure.globalMeasure, "tempos");
  tempos.push(tempo);
  return tempo;
}

function applyTempoExpression(gap: DenigmaGap, expression: ExpressionPayload, index: TargetIndex): GapApplication {
  if (expression.type === "tempo-alteration") {
    return addTextExpression(gap, expression, index);
  }
  const tempo = findOrCreateTempo(gap, expression, index);
  if (!tempo) return outcome("unhandled", "No standard tempo target or usable BPM was available.");
  const extensions = tempoExtension(tempo);
  const text = tempoDisplayText(expression);
  if (text) {
    extensions["text"] = text;
    if (!hasVisibleMetronome(expression)) extensions["showMetronomeMark"] = false;
  }

  const metronome = expression.metronome;
  if (metronome && metronome.displayedBeatsPerMinute !== metronome.tempo.beatsPerMinute) {
    return outcome("handled-partially", "Displayed and playback metronome values differ; playback BPM was retained.");
  }
  return outcome(
    expression.text?.plain !== undefined ? "handled-partially" : "handled",
    expression.text?.plain !== undefined ? "Preserved plain text but not source formatting." : undefined,
  );
}

function applyExpressionGap(gap: DenigmaGap, index: TargetIndex): GapApplication {
  if (!isExpressionGap(gap)) return outcome("unhandled", "Malformed expression payload.");
  switch (gap.expression.type) {
    case "generic-text":
      return addTextExpression(gap, gap.expression, index);
    case "technique-text": {
      const result = addTextExpression(gap, gap.expression, index);
      return result.outcome.disposition === "unhandled"
        ? result
        : outcome("handled-partially", "Preserved visible text but not performance-technique semantics.");
    }
    case "rehearsal-mark":
      return addRehearsalMark(gap, gap.expression, index);
    case "tempo-mark":
    case "metronome-mark":
    case "tempo-alteration":
      return applyTempoExpression(gap, gap.expression, index);
    default:
      return outcome("unhandled", `Unsupported expression subtype ${gap.expression.type}.`);
  }
}

function applyPlaybackOnlyGap(gap: DenigmaGap, index: TargetIndex): GapApplication {
  const tempo = index.byId(gap.anchor);
  if (!tempo || typeof tempo["bpm"] !== "number") {
    return outcome("unhandled", "Playback-only gap does not reference a standard MNX tempo.");
  }
  const extensions = tempoExtension(tempo);
  extensions["showMetronomeMark"] = false;
  extensions["showText"] = false;
  return outcome("handled");
}

function lineText(line: GeneralLinePayload): string | undefined {
  return line.centerFullText?.plain?.trim() || undefined;
}

function lineStyle(line: GeneralLinePayload): { style?: "straight" | "wavy"; partial?: string } {
  if (line.lineStyle === "solid") return { style: "straight" };
  if (line.lineStyle === "char" && line.lineChar?.glyph === "wiggleGlissando") return { style: "wavy" };
  if (line.lineStyle === "char" && line.lineChar?.glyph?.startsWith("wiggle")) {
    return { style: "wavy", partial: "Collapsed a custom waveform to the standard wavy glissando." };
  }
  return { partial: `Unsupported glissando line style ${line.lineStyle}.` };
}

function hasUnsupportedLineDetails(line: GeneralLinePayload): boolean {
  return (
    line.lineVisible === false ||
    line.lineWidth !== undefined ||
    line.dashOn !== undefined ||
    line.dashOff !== undefined ||
    line.startText !== undefined ||
    line.continuationText !== undefined ||
    line.endText !== undefined ||
    line.centerAbbrText !== undefined ||
    (line.startCap?.type !== undefined && line.startCap.type !== "none") ||
    (line.endCap?.type !== undefined && line.endCap.type !== "none")
  );
}

function applyGlissando(gap: DenigmaGap, index: TargetIndex): GapApplication {
  if (!isSmartShapeGap(gap) || gap.smartShape.shapeType === "tab-slide") {
    return outcome("unhandled", "Tab slides are not represented by the current Viritura model.");
  }
  const line = gap.smartShape.glissando?.line;
  const source = index.event(gap);
  const target = gap.end ? index.event(gap.end) : undefined;
  const sourceId = source && eventId(source.event);
  const targetId = target && eventId(target.event);
  if (!line || !sourceId || !targetId)
    return outcome("unhandled", "Glissando endpoints or line payload are unavailable.");
  if (line.lineVisible === false) {
    return outcome("unhandled", "Invisible glissando lines are not represented by the current Viritura model.");
  }
  const mappedStyle = lineStyle(line);
  if (!mappedStyle.style) return outcome("unhandled", mappedStyle.partial);

  const extensions = ensureViritura(source.event);
  const glissandos = ensureArrayProperty(extensions, "glissandos");
  const text = lineText(line);
  const value: JsonRecord = {
    target: targetId,
    kind: "glissando",
    style: mappedStyle.style,
    ...(text ? { text } : {}),
  };
  const duplicate = glissandos.some(
    (candidate) => isRecord(candidate) && candidate["target"] === targetId && candidate["kind"] === "glissando",
  );
  if (!duplicate) glissandos.push(value);
  const reason =
    mappedStyle.partial ??
    (line.centerFullText !== undefined || hasUnsupportedLineDetails(line)
      ? "Preserved the semantic line subset and plain center text."
      : gap.end?.anchor !== gap.anchor
        ? "Cross-measure span preserved; cross-system line segmentation is not rendered."
        : undefined);
  return outcome(reason ? "handled-partially" : "handled", reason);
}

function applyTrillLine(gap: DenigmaGap, index: TargetIndex): GapApplication {
  if (!isSmartShapeGap(gap)) return outcome("unhandled", "Malformed trill-line payload.");
  const trillLine = gap.smartShape.trillLine;
  const source = index.event(gap);
  const target = gap.end ? index.event(gap.end, true) : undefined;
  const sourceId = source && eventId(source.event);
  const targetId = target && eventId(target.event);
  if (!trillLine || !sourceId || !targetId) return outcome("unhandled", "Trill-line endpoints are unavailable.");

  const markings = ensureRecordProperty(source.event, "markings");
  const extensions = ensureViritura(markings);
  const existing = isRecord(extensions["trill"]) ? extensions["trill"] : {};
  extensions["trill"] = {
    ...existing,
    showSymbol: trillLine.includesTrSymbol,
    extension: { target: targetId, targetEdge: target.edge },
  };
  const reason =
    trillLine.line !== undefined
      ? "Preserved the semantic trill span but not custom line appearance."
      : gap.end?.anchor !== gap.anchor
        ? "Cross-measure span preserved; cross-system line segmentation is not rendered."
        : undefined;
  return outcome(reason ? "handled-partially" : "handled", reason);
}

function applySmartShapeGap(gap: DenigmaGap, index: TargetIndex): GapApplication {
  if (!isSmartShapeGap(gap)) return outcome("unhandled", "Malformed smart-shape payload.");
  if (gap.smartShape.kind === "glissando") return applyGlissando(gap, index);
  if (gap.smartShape.kind === "trill-line") return applyTrillLine(gap, index);
  return outcome("unhandled", `Unsupported smart-shape kind ${gap.smartShape.kind}.`);
}

function noteheadShape(payload: NoteheadPayload): {
  shape?: "normal" | "x" | "circleX" | "diamond" | "slash" | "triangleUp" | "triangleDown";
  reason?: string;
} {
  switch (payload.shape) {
    case "regular":
      return { shape: "normal" };
    case "x":
      return { shape: "x" };
    case "diamond":
      return { shape: "diamond" };
    case "small-slash":
    case "large-slash":
      return { shape: "slash", reason: "Collapsed Finale's small/large slash distinction." };
    case "other": {
      const shape = payload.glyph ? NOTEHEAD_GLYPH_MAP[payload.glyph] : undefined;
      return shape
        ? { shape, reason: `Mapped the recognized ${payload.glyph} glyph to Viritura's ${shape} shape.` }
        : {};
    }
    default:
      return {};
  }
}

function applyNoteheadGap(gap: DenigmaGap, index: TargetIndex): GapApplication {
  if (!isNoteheadGap(gap)) return outcome("unhandled", "Malformed notehead payload.");
  const note = index.byId(gap.anchor);
  if (!note || !isRecord(note["pitch"])) {
    return outcome("unhandled", "Notehead gap does not reference a pitched MNX note.");
  }
  const mapped = noteheadShape(gap.notehead);
  if (!mapped.shape) {
    return outcome(
      "unhandled",
      `Unsupported notehead shape ${gap.notehead.shape}${gap.notehead.glyph ? ` (${gap.notehead.glyph})` : ""}.`,
    );
  }

  const extensions = ensureViritura(note);
  const existing = extensions["notehead"];
  if (typeof existing === "string" && existing !== mapped.shape) {
    return outcome("handled-partially", "An existing Viritura notehead override took precedence.");
  }
  extensions["notehead"] = mapped.shape;

  const reason =
    mapped.reason ??
    (gap.notehead.fill !== "unspecified" ? "Explicit source fill is not represented by Viritura." : undefined);
  return outcome(reason ? "handled-partially" : "handled", reason);
}

type GapAdapter = (gap: DenigmaGap, index: TargetIndex) => GapApplication;

const SCHEMA_V1_ADAPTERS: Readonly<Record<string, GapAdapter>> = {
  expression: applyExpressionGap,
  notehead: applyNoteheadGap,
  "playback-only": applyPlaybackOnlyGap,
  "smart-shape": applySmartShapeGap,
};

function applyGap(gap: DenigmaGap, index: TargetIndex): GapApplication {
  const adapter = SCHEMA_V1_ADAPTERS[gap.type];
  return adapter ? adapter(gap, index) : outcome("unhandled", `Unsupported Denigma gap type ${gap.type}.`);
}

function assertMnxEnvelope(value: unknown): JsonRecord {
  const document = asDocumentRecord(value);
  if (!document || !isRecord(document["mnx"]) || !isRecord(document["global"]) || !Array.isArray(document["parts"])) {
    throw new Error("Denigma returned invalid MNX: expected mnx, global, and parts at the document root.");
  }
  return document;
}

export function applyDenigmaGapReport(
  mnxJson: string,
  report: DenigmaGapReport,
  indentSpaces?: number,
): GapAdaptationResult {
  if (report.schemaVersion !== 1) {
    throw new Error(`Unsupported Denigma gap-report schema version ${String(report.schemaVersion)}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(mnxJson);
  } catch (error) {
    throw new Error(`Denigma returned invalid MNX JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const document = assertMnxEnvelope(parsed);
  const index = new TargetIndex(document);
  const diagnostics: DenigmaDiagnostic[] = [];
  const chordApplications = applyChordSymbolGaps(report.gaps, index, diagnostics);
  const outcomes = report.gaps.map((gap, gapIndex) => {
    const application = chordApplications.get(gapIndex) ?? applyGap(gap, index);
    const result: DenigmaGapOutcome = {
      gapIndex,
      type: gap.type,
      ...(subtypeOf(gap) ? { subtype: subtypeOf(gap) } : {}),
      anchor: gap.anchor,
      ...application.outcome,
    };
    if (result.disposition !== "handled") {
      diagnostics.push({
        severity: "warning",
        message: `Denigma gap ${gapIndex + 1} (${result.subtype ?? result.type}) was ${result.disposition}: ${result.reason ?? "no reason provided"}`,
      });
    }
    return result;
  });

  return {
    mnxJson: JSON.stringify(document, null, indentSpaces),
    outcomes,
    diagnostics,
  };
}
