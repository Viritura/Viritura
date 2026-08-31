// MNX Parser — parseParts (split from parser.ts)
//
// Schema-defined inputs (Part, PartMeasure, Kit, KitComponent, Beam,
// Arpeggio, NonArpeggio, PositionedClef) now consume the generated
// Raw* types. The vendor-extension blocks under `_x.viritura` (pedal,
// pedal, chordSymbol, textExpression, condensingOverride, transposition,
// part identity) are still narrowed with `as Record<string, unknown>`
// because the schema deliberately leaves vendor dicts opaque.

import type {
  PartMeasure,
  Beam,
  PartMeasureArpeggio,
  NonArpeggio,
  MeasureRepeat,
  MeasureRepeatCounter,
} from "@viritura/core";
import type { Part } from "@viritura/core";
import type { PositionedClef, Clef } from "@viritura/core";
import type { ClefSign, KitComponent, NoteheadShape } from "@viritura/core";

import type {
  Part as RawPart,
  PartMeasure as RawPartMeasure,
  Kit as RawKit,
  KitComponent as RawKitComponent,
  Beam as RawBeam,
  Arpeggio as RawArpeggio,
  NonArpeggio as RawNonArpeggio,
  MeasureRepeat as RawMeasureRepeat,
  PositionedClef as RawPositionedClef,
  IdPair as RawIdPair,
} from "@viritura/core/raw";
import type {
  PartExtensions as RawPartExt,
  PartMeasureExtensions as RawPartMeasureExt,
  KitComponentExtensions as RawKitComponentExt,
} from "@viritura/core/raw-viritura";

import {
  parseDynamicGroup,
  parseOttava,
  parseChordSymbol,
  parseTextExpression,
  parsePedal,
  parseRhythmicPosition,
} from "./parseGlobal";
import { parseSequences } from "./parseContent";

// ═══════════════════════════════════════════
// Parts
// ═══════════════════════════════════════════

export function parseParts(arr: RawPart[] | undefined): Part[] {
  if (!arr) return [];
  return arr.map(parsePart);
}

function parsePart(raw: RawPart): Part {
  const part: Part = {
    name: raw.name ?? "",
    measures: parsePartMeasures(raw.measures),
  };
  if (raw.id) part.id = raw.id;
  if (raw.shortName !== undefined) part.shortName = raw.shortName;
  if (raw.staves !== undefined) part.staves = raw.staves;
  if (raw.transposition) {
    const t = raw.transposition;
    part.transposition = {
      interval: {
        halfSteps: t.interval.halfSteps,
        staffDistance: t.interval.staffDistance,
      },
    };
    if (t.keyFifthsFlipAt !== undefined) part.transposition.keyFifthsFlipAt = t.keyFifthsFlipAt;
    if (t.prefersWrittenPitches !== undefined) part.transposition.prefersWrittenPitches = t.prefersWrittenPitches;
  }
  if (raw.kit) {
    part.kit = parseKit(raw.kit);
  }
  // _x.viritura vendor extensions (instrument identity + spatial placement)
  const viritura = raw._x?.["viritura"] as RawPartExt | undefined;
  if (viritura) {
    const ext: { instrumentId?: string; midiProgram?: number; family?: string; spatial?: { x: number; y: number } } =
      {};
    if (typeof viritura.instrumentId === "string") ext.instrumentId = viritura.instrumentId;
    if (typeof viritura.midiProgram === "number") ext.midiProgram = viritura.midiProgram;
    if (typeof viritura.family === "string") ext.family = viritura.family;
    const sp = viritura.spatial;
    if (sp && typeof sp.x === "number" && typeof sp.y === "number") {
      ext.spatial = { x: sp.x, y: sp.y };
    }
    if (Object.keys(ext).length > 0) {
      part._x = { viritura: ext };
    }
  }
  return part;
}

function parseKit(raw: RawKit): Record<string, KitComponent> {
  const result: Record<string, KitComponent> = {};
  for (const [id, value] of Object.entries(raw)) {
    result[id] = parseKitComponent(value);
  }
  return result;
}

function parseKitComponent(raw: RawKitComponent): KitComponent {
  const c: KitComponent = {
    staffPosition: raw.staffPosition ?? 0,
  };
  if (typeof raw.name === "string") c.name = raw.name;
  if (typeof raw.sound === "string") c.sound = raw.sound;
  // _x.viritura vendor extensions: notehead (MNX issue #249) + drumKit override.
  const viritura = raw._x?.["viritura"] as RawKitComponentExt | undefined;
  if (viritura?.notehead) {
    c.notehead = viritura.notehead as NoteheadShape;
  }
  if (typeof viritura?.drumKit === "number") {
    c.drumKit = viritura.drumKit;
  }
  return c;
}

function parsePartMeasures(arr: RawPartMeasure[] | undefined): PartMeasure[] {
  if (!arr) return [];
  return arr.map(parsePartMeasure);
}

function parsePartMeasure(raw: RawPartMeasure): PartMeasure {
  const pm: PartMeasure = {
    sequences: parseSequences(raw.sequences),
  };
  const clefs = parseClefs(raw.clefs);
  if (clefs !== undefined) pm.clefs = clefs;
  if (raw.beams) {
    pm.beams = raw.beams.map(parseBeam);
  }
  if (raw.arpeggios) {
    pm.arpeggios = raw.arpeggios.map(parseArpeggio);
  }
  if (raw.nonArpeggios) {
    pm.nonArpeggios = raw.nonArpeggios.map(parseNonArpeggio);
  }
  if (raw.dynamics) {
    pm.dynamics = raw.dynamics.map(parseDynamicGroup);
  }
  if (raw.ottavas) {
    pm.ottavas = raw.ottavas.map(parseOttava);
  }
  if (raw.measureRepeat) {
    pm.measureRepeat = parseMeasureRepeat(raw.measureRepeat);
  }

  // _x.viritura vendor extensions (none of these are in the MNX schema)
  const viritura = raw._x?.["viritura"] as RawPartMeasureExt | undefined;
  if (viritura) {
    if (viritura.pedals) {
      pm.pedals = viritura.pedals.map(parsePedal);
    }
    if (viritura.chordSymbols) {
      pm.chordSymbols = viritura.chordSymbols.map(parseChordSymbol);
    }
    if (viritura.expressions) {
      pm.expressions = viritura.expressions.map(parseTextExpression);
    }
    if (viritura.condensingOverride) {
      pm.condensingOverride = viritura.condensingOverride;
    }
  }
  return pm;
}

function parseMeasureRepeat(raw: RawMeasureRepeat): MeasureRepeat {
  const measureRepeat: MeasureRepeat = { number: raw.number };
  if (raw.counter !== undefined) {
    const counter: MeasureRepeatCounter = { count: raw.counter.count };
    if (raw.counter.orient !== undefined) counter.orient = raw.counter.orient;
    measureRepeat.counter = counter;
  }
  if (raw.displayNumber !== undefined) measureRepeat.displayNumber = raw.displayNumber;
  if (raw.staffPosition !== undefined) measureRepeat.staffPosition = raw.staffPosition;
  return measureRepeat;
}

function parseArpeggio(raw: RawArpeggio): PartMeasureArpeggio {
  const arpeggio: PartMeasureArpeggio = {
    position: parseRhythmicPosition(raw.position),
    span: parseIdPair(raw.span),
  };
  if (raw.direction !== undefined) arpeggio.direction = raw.direction;
  if (raw.arrow !== undefined) arpeggio.arrow = raw.arrow;
  if (raw.id !== undefined) arpeggio.id = raw.id;
  return arpeggio;
}

function parseNonArpeggio(raw: RawNonArpeggio): NonArpeggio {
  const nonArpeggio: NonArpeggio = {
    position: parseRhythmicPosition(raw.position),
    span: parseIdPair(raw.span),
  };
  if (raw.id !== undefined) nonArpeggio.id = raw.id;
  return nonArpeggio;
}

function parseIdPair(raw: RawIdPair): { start: string; end: string } {
  return {
    start: raw.start,
    end: raw.end,
  };
}

// ═══════════════════════════════════════════
// Beams
// ═══════════════════════════════════════════

function parseBeam(raw: RawBeam): Beam {
  const beam: Beam = {
    events: raw.events,
  };
  if (raw.beams && raw.beams.length > 0) {
    // Inner beams are `beam-list` (recursive) — same shape as outer beams.
    beam.beams = raw.beams.map((b) => parseBeam(b as RawBeam));
  }
  if (raw.direction) {
    beam.direction = raw.direction;
  }
  return beam;
}

// ═══════════════════════════════════════════
// Clefs
// ═══════════════════════════════════════════

function parseClefs(arr: RawPositionedClef[] | undefined): PositionedClef[] | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr.map(parsePositionedClef);
}

function parsePositionedClef(raw: RawPositionedClef): PositionedClef {
  const rawClef = raw.clef;
  const clef: Clef = {
    sign: (rawClef.sign as ClefSign) ?? "G",
    staffPosition: rawClef.staffPosition ?? -2,
  };
  if (rawClef.color) clef.color = rawClef.color;
  if (rawClef.glyph) clef.glyph = rawClef.glyph;
  if (rawClef.octave !== undefined) clef.octave = rawClef.octave;
  if (rawClef.showOctave !== undefined) clef.showOctave = rawClef.showOctave;

  const result: PositionedClef = { clef };

  if (raw.position) {
    if (raw.position.fraction) {
      result.position = { fraction: raw.position.fraction as [number, number] };
    }
  }

  if (raw.staff !== undefined) {
    result.staff = raw.staff;
  }

  return result;
}
