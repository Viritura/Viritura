// MNX Parser — parseGlobal (split from parser.ts)
//
// Schema-defined inputs (sounds, lyrics, measure-global, time, key,
// barline, ending, tempo, segno, fine, jump, dynamic-group, ottava,
// rhythmic-position, measure-rhythmic-position, repeat-start, repeat-end)
// now consume the generated Raw* types — schema drift surfaces as a
// compile error here.
//
// Viritura vendor extensions (pedal, chordSymbol, textExpression,
// coda) are NOT defined in the MNX schema, so their inputs remain
// Record<string, unknown>. See docs/spec/viritura-extensions.md for
// the layered types.

import type { GlobalLyrics, LyricLineMetadataEntry } from "@viritura/core";
import type { Sound } from "@viritura/core";
import { generateId } from "@viritura/core";
import type {
  GlobalMeasure,
  RhythmicPosition,
  Tempo,
  TempoNoteValue,
  DynamicGroup,
  DynamicGroupBase,
  MeasureRhythmicPosition,
  Ottava,
  Pedal,
  PedalType,
  PedalLineStyle,
  Segno,
  Fine,
  Jump,
  Coda,
  GradualTempo,
  GradualTempoKind,
  RepeatStart,
  RepeatEnd,
  Ending,
  TextExpression,
  ExpressionPlacement,
  ChordSymbol,
  ChordRoot,
  ChordQuality,
} from "@viritura/core";
import type { TimeSignature } from "@viritura/core";
import type { KeySignature } from "@viritura/core";
import type { Barline } from "@viritura/core";
import type { NoteValueBase, BarlineType } from "@viritura/core";

import type {
  SoundsGlobal as RawSoundsGlobal,
  LyricsGlobal as RawLyricsGlobal,
  MeasureGlobal as RawMeasureGlobal,
  RhythmicPosition as RawRhythmicPosition,
  MeasureRhythmicPosition as RawMeasureRhythmicPosition,
  Tempo as RawTempo,
  NoteValue as RawNoteValue,
  DynamicGroup as RawDynamicGroup,
  Ottava as RawOttava,
  Segno as RawSegno,
  Fine as RawFine,
  Jump as RawJump,
  Ending as RawEnding,
  RepeatStart as RawRepeatStart,
  RepeatEnd as RawRepeatEnd,
  Time as RawTime,
  Key as RawKey,
  Barline as RawBarline,
} from "@viritura/core/raw";
import type {
  DynamicGroupExtensions as RawDynamicGroupExt,
  MeasureGlobalExtensions as RawMeasureGlobalExt,
  Pedal as RawPedal,
  ChordSymbol as RawChordSymbol,
  ChordRoot as RawChordRoot,
  TextExpression as RawTextExpression,
  Coda as RawCoda,
  Jump as RawVendorJump,
  GradualTempo as RawGradualTempo,
} from "@viritura/core/raw-viritura";

/** Untyped vendor-extension payload — used only for fields outside the
 * extensions schema (e.g. legacy `times` on repeat-start, atonal key flag). */
type VendorObj = Record<string, unknown>;

// ═══════════════════════════════════════════
// Global sounds (drum-kit / GM sound registry)
// ═══════════════════════════════════════════

export function parseGlobalSounds(raw: RawSoundsGlobal): Record<string, Sound> {
  const out: Record<string, Sound> = {};
  for (const key of Object.keys(raw)) {
    const s = raw[key]!;
    const sound: Sound = {};
    if (typeof s.midiNumber === "number") sound.midiNumber = s.midiNumber;
    if (typeof s.name === "string") sound.name = s.name;
    if (typeof s.id === "string") sound.id = s.id;
    out[key] = sound;
  }
  return out;
}

// ═══════════════════════════════════════════
// Global lyrics
// ═══════════════════════════════════════════

export function parseGlobalLyrics(raw: RawLyricsGlobal): GlobalLyrics {
  const result: GlobalLyrics = {};
  if (raw.lineMetadata) {
    const entries: Record<string, LyricLineMetadataEntry> = {};
    for (const key of Object.keys(raw.lineMetadata)) {
      const entry = raw.lineMetadata[key]!;
      const parsed: LyricLineMetadataEntry = {};
      if (entry.label) parsed.label = entry.label;
      if (entry.lang) parsed.lang = entry.lang;
      entries[key] = parsed;
    }
    result.lineMetadata = entries;
  }
  if (raw.lineOrder) {
    result.lineOrder = raw.lineOrder;
  }
  return result;
}

// ═══════════════════════════════════════════
// Global measures
// ═══════════════════════════════════════════

export function parseGlobalMeasures(arr: RawMeasureGlobal[] | undefined): GlobalMeasure[] {
  if (!arr) return [];
  return arr.map(parseGlobalMeasure);
}

function parseGlobalMeasure(raw: RawMeasureGlobal): GlobalMeasure {
  const measure: GlobalMeasure = {};

  if (raw.id) measure.id = raw.id;
  if (raw.number !== undefined) measure.number = raw.number;

  if (raw.time) measure.time = parseTimeSignature(raw.time);
  if (raw.key) measure.key = parseKeySignature(raw.key);
  if (raw.barline) measure.barline = parseBarline(raw.barline);

  if (raw.repeatStart !== undefined) {
    measure.repeatStart = parseRepeatStart(raw.repeatStart);
  }
  if (raw.repeatEnd !== undefined) {
    measure.repeatEnd = parseRepeatEnd(raw.repeatEnd);
  }
  if (raw.ending !== undefined) {
    measure.ending = parseEnding(raw.ending);
  }
  if (raw.tempos) {
    measure.tempos = raw.tempos.map(parseTempo);
  }
  if (raw.segno) measure.segno = parseSegno(raw.segno);
  if (raw.fine) measure.fine = parseFine(raw.fine);
  if (raw.jump) measure.jump = parseJump(raw.jump);

  // _x.viritura vendor extensions on the global measure
  const viritura = raw._x?.["viritura"] as RawMeasureGlobalExt | undefined;
  if (viritura) {
    if (viritura.senzaMisura && measure.time) measure.time.display = "senzaMisura";
    if (viritura.rehearsalMark) {
      const rm = viritura.rehearsalMark;
      measure.rehearsalMark = { text: rm.text };
      if (rm.style) measure.rehearsalMark.style = rm.style;
      applyManualPlacement(measure.rehearsalMark, rm as VendorObj);
    }
    if (viritura.coda) {
      measure.coda = parseCoda(viritura.coda);
    }
    if (viritura.jump) {
      measure.jump = parseJump(viritura.jump);
    }
    if (viritura.gradualTempo) {
      measure.gradualTempo = parseGradualTempo(viritura.gradualTempo);
    }
  }

  return measure;
}

function parseRepeatStart(raw: RawRepeatStart): RepeatStart {
  const r: RepeatStart = {};
  // `times` is an extension on top of repeat-start (schema only requires
  // global-attrs); keep the existing parsing behavior.
  const times = (raw as VendorObj)["times"];
  if (typeof times === "number") r.times = times;
  return r;
}

function parseRepeatEnd(raw: RawRepeatEnd): RepeatEnd {
  const r: RepeatEnd = {};
  if (raw.times !== undefined) r.times = raw.times;
  return r;
}

function parseEnding(raw: RawEnding): Ending {
  const ending: Ending = {
    duration: raw.duration,
    numbers: (raw.numbers ?? []) as number[],
  };
  if (raw.open !== undefined) ending.open = raw.open;
  if (raw.color) ending.color = raw.color;
  return ending;
}

// ═══════════════════════════════════════════
// Direction types (tempo, dynamic, ottava, jump markers)
// ═══════════════════════════════════════════

/** Read `manualOffset` ([dx, dy]) and `avoidCollisions` (bool) from a vendor
 *  object onto a target that carries those optional fields. Shared by tempo /
 *  dynamic / rehearsal / expression. */
function applyManualPlacement(
  target: { manualOffset?: [number, number]; avoidCollisions?: boolean },
  src: VendorObj | undefined,
): void {
  if (!src) return;
  const mo = src["manualOffset"];
  if (Array.isArray(mo) && mo.length === 2) {
    const [dx, dy] = mo;
    if (typeof dx === "number" && typeof dy === "number") target.manualOffset = [dx, dy];
  }
  if (typeof src["avoidCollisions"] === "boolean") target.avoidCollisions = src["avoidCollisions"];
}

export function parseRhythmicPosition(raw: RawRhythmicPosition): RhythmicPosition {
  // Schema types fraction as integer-unsigned[]; decoded model wants tuple.
  return { fraction: raw.fraction as [number, number] };
}

function parseTempo(raw: RawTempo): Tempo {
  const tempo: Tempo = {
    bpm: raw.bpm,
    value: parseTempoNoteValue(raw.value),
  };
  if (raw.location) {
    tempo.location = parseRhythmicPosition(raw.location);
  }
  // _x.viritura vendor extensions on the tempo object
  // (tempo-extensions is not in the schema yet — keep narrow casts.)
  const viritura = raw._x?.["viritura"] as VendorObj | undefined;
  if (viritura) {
    if (typeof viritura["text"] === "string") tempo.text = viritura["text"];
    if (typeof viritura["showMetronomeMark"] === "boolean")
      tempo.showMetronomeMark = viritura["showMetronomeMark"] as boolean;
    if (typeof viritura["showText"] === "boolean") tempo.showText = viritura["showText"] as boolean;
    applyManualPlacement(tempo, viritura);
  }
  return tempo;
}

function parseTempoNoteValue(raw: RawNoteValue): TempoNoteValue {
  const tnv: TempoNoteValue = {
    base: raw.base as NoteValueBase,
  };
  if (raw.dots !== undefined) tnv.dots = raw.dots;
  return tnv;
}

/**
 * Dynamic-group fields that copy across unchanged when present. Listing them
 * keeps the parser's branch count flat as the spec grows.
 */
const DYNAMIC_GROUP_SCALAR_FIELDS = [
  "value",
  "residualValue",
  "accentPrefix",
  "accentSuffix",
  "orient",
  "prefix",
  "relativeValue",
  "staff",
  "staffEnd",
  "suffix",
  "visuallyContinues",
  "voice",
  "wedgeType",
] as const satisfies readonly (keyof DynamicGroupBase & keyof RawDynamicGroup)[];

export function parseDynamicGroup(raw: RawDynamicGroup): DynamicGroup {
  const common: Omit<DynamicGroupBase, "type"> = {
    id: raw.id ?? generateId(),
    position: parseRhythmicPosition(raw.position),
  };
  for (const field of DYNAMIC_GROUP_SCALAR_FIELDS) {
    const value = raw[field];
    if (value !== undefined) Object.assign(common, { [field]: value });
  }
  if (raw.end !== undefined) common.end = parseMeasureRhythmicPosition(raw.end);
  if (raw.glyphs !== undefined) common.glyphs = [...raw.glyphs];
  applyManualPlacement(common, raw._x?.["viritura"] as RawDynamicGroupExt | undefined);

  switch (raw.type) {
    case "immediate":
      if (raw.value === undefined) throw new Error(`Dynamic group ${common.id} of type immediate requires value`);
      return { ...common, type: "immediate", value: raw.value };
    case "gradual":
      if (common.end === undefined || raw.wedgeType === undefined) {
        throw new Error(`Dynamic group ${common.id} of type gradual requires end and wedgeType`);
      }
      return { ...common, type: "gradual", end: common.end, wedgeType: raw.wedgeType };
    case "relative":
      if (raw.relativeValue === undefined) {
        throw new Error(`Dynamic group ${common.id} of type relative requires relativeValue`);
      }
      return { ...common, type: "relative", relativeValue: raw.relativeValue };
    case "accent":
      if (raw.value === undefined) throw new Error(`Dynamic group ${common.id} of type accent requires value`);
      return { ...common, type: "accent", value: raw.value };
  }
}

function parseMeasureRhythmicPosition(raw: RawMeasureRhythmicPosition): MeasureRhythmicPosition {
  return {
    measure: raw.measure,
    position: parseRhythmicPosition(raw.position),
  };
}

export function parseOttava(raw: RawOttava): Ottava {
  const ott: Ottava = {
    position: parseRhythmicPosition(raw.position),
    end: parseMeasureRhythmicPosition(raw.end),
    value: raw.value,
  };
  if (raw.staff !== undefined) ott.staff = raw.staff;
  if (raw.voice) ott.voice = raw.voice;
  return ott;
}

// ───────────────────────────────────────────
// Vendor-extension parsers
// ───────────────────────────────────────────

export function parsePedal(raw: RawPedal): Pedal {
  const pedal: Pedal = {
    type: raw.type as PedalType,
    position: parseRhythmicPosition(raw.position),
    end: parseMeasureRhythmicPosition(raw.end),
  };
  if (raw.style) pedal.style = raw.style as PedalLineStyle;
  if (raw.staff !== undefined) pedal.staff = raw.staff;
  if (raw.voice) pedal.voice = raw.voice;
  return pedal;
}

function parseChordRoot(raw: RawChordRoot): ChordRoot {
  const root: ChordRoot = {
    step: raw.step,
  };
  if (raw.alter !== undefined) root.alter = raw.alter;
  return root;
}

export function parseChordSymbol(raw: RawChordSymbol): ChordSymbol {
  const cs: ChordSymbol = {
    position: parseRhythmicPosition(raw.position),
    root: parseChordRoot(raw.root),
    quality: raw.quality as ChordQuality,
  };
  if (raw.bass) cs.bass = parseChordRoot(raw.bass);
  if (raw.extension !== undefined) cs.extension = raw.extension;
  if (raw.textOverride) cs.textOverride = raw.textOverride;
  return cs;
}

export function parseTextExpression(raw: RawTextExpression): TextExpression {
  const expr: TextExpression = {
    text: raw.text,
    position: parseRhythmicPosition(raw.position),
  };
  if (raw.placement) expr.placement = raw.placement as ExpressionPlacement;
  if (raw.staff !== undefined) expr.staff = raw.staff;
  if (raw.voice) expr.voice = raw.voice;
  const mo = raw.manualOffset;
  if (Array.isArray(mo) && mo.length === 2) {
    const [dx, dy] = mo;
    if (typeof dx === "number" && typeof dy === "number") expr.manualOffset = [dx, dy];
  }
  if (typeof raw.avoidCollisions === "boolean") expr.avoidCollisions = raw.avoidCollisions;
  return expr;
}

// ───────────────────────────────────────────
// Schema direction markers (segno / fine / jump / coda)
// ───────────────────────────────────────────

function parseSegno(raw: RawSegno): Segno {
  const segno: Segno = {
    location: parseRhythmicPosition(raw.location),
  };
  if (raw.glyph) segno.glyph = raw.glyph;
  if (raw.color) segno.color = raw.color;
  return segno;
}

function parseFine(raw: RawFine): Fine {
  const fine: Fine = {
    location: parseRhythmicPosition(raw.location),
  };
  if (raw.color) fine.color = raw.color;
  return fine;
}

function parseJump(raw: RawJump | RawVendorJump): Jump {
  return {
    type: raw.type as "segno" | "dsalfine" | "dsalcoda" | "dcalcoda",
    location: parseRhythmicPosition(raw.location),
  };
}

/** Coda is a Viritura vendor extension (no MNX schema). */
function parseCoda(raw: RawCoda): Coda {
  const coda: Coda = {
    location: parseRhythmicPosition(raw.location),
  };
  if (raw.glyph) coda.glyph = raw.glyph;
  if (raw.color) coda.color = raw.color;
  return coda;
}

/** Gradual tempo (rit./accel.) is a Viritura vendor extension (no MNX schema). */
function parseGradualTempo(raw: RawGradualTempo): GradualTempo {
  const gt: GradualTempo = {
    position: parseRhythmicPosition(raw.position),
    end: parseMeasureRhythmicPosition(raw.end),
    endBpm: raw.endBpm,
  };
  if (raw.startBpm !== undefined) gt.startBpm = raw.startBpm;
  if (raw.kind) gt.kind = raw.kind as GradualTempoKind;
  return gt;
}

// ═══════════════════════════════════════════
// Simple types
// ═══════════════════════════════════════════

function parseTimeSignature(raw: RawTime): TimeSignature {
  const ts: TimeSignature = {
    count: raw.count ?? 4,
    unit: raw.unit ?? 4,
  };
  if (raw.display === "common" || raw.display === "cut") {
    ts.display = raw.display;
  }
  return ts;
}

function parseKeySignature(raw: RawKey): KeySignature {
  const key: KeySignature = {
    fifths: raw.fifths ?? 0,
  };
  if (raw.color) key.color = raw.color;
  const viritura = raw._x?.["viritura"] as VendorObj | undefined;
  if (viritura?.["atonal"]) key.atonal = true;
  return key;
}

function parseBarline(raw: RawBarline): Barline {
  return {
    type: (raw.type as BarlineType) ?? "regular",
  };
}
