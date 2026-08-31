/**
 * buildMnx — helper functions to construct MNX JSON from structured args.
 *
 * These helpers make it easy to create valid MNX documents in stories
 * without hand-writing JSON. They produce the minimal valid structure
 * needed for the requested features.
 */

import { createDynamicGroup } from "@viritura/core";

// ─── Types for builder args ────────────────────────────────────

interface NoteArgs {
  id?: string;
  step?: string;
  octave?: number;
  alter?: number;
  accidentalDisplay?: { show: boolean; force?: boolean; enclosure?: { symbol: string } };
  ties?: Array<{ target: string; side?: string; lv?: boolean }>;
}

export interface EventArgs {
  duration?: string;
  dots?: number;
  notes?: NoteArgs[];
  rest?: boolean;
  restStaffPosition?: number;
  id?: string;
  /** Cross-staff override: render this event on the given staff (1-indexed) */
  staff?: number;
  /** Standard MNX markings */
  markings?: Record<string, unknown>;
  /** Native MNX fermata (event-level since v15). */
  fermata?: Record<string, unknown>;
  /** Viritura extension markings (placed in _x.viritura) */
  virituraMarkings?: Record<string, unknown>;
  /** Viritura event extensions (placed in _x.viritura on event) */
  virituraExtensions?: Record<string, unknown>;
  /** Slurs starting from this event */
  slurs?: Array<{
    target: string;
    side?: string;
    sideEnd?: string;
    lineType?: string;
    startNote?: string;
    endNote?: string;
  }>;
  /** Ties on notes */
  ties?: Array<{ target: string; side?: string; lv?: boolean }>;
  /** Optional color for this event */
  color?: string;
}

export interface MeasureArgs {
  /** Global measure properties */
  time?: { count: number; unit: number };
  key?: { fifths: number };
  barline?: { type: string };
  id?: string;
  /** Custom measure number override (MNX measure-number) */
  number?: number;
  /** Repeat start marker */
  repeatStart?: Record<string, unknown> | boolean;
  /** Repeat end marker (optionally with times count) */
  repeatEnd?: { times?: number } | Record<string, unknown> | boolean;
  /** Volta ending */
  ending?: { duration: number; numbers: number[]; open?: boolean };
  /** Standard MNX global properties */
  segno?: { location: { fraction: number[] } };
  fine?: { location: { fraction: number[] } };
  jump?: { type: string; location: { fraction: number[] } };
  tempos?: Array<{
    bpm: number;
    value: { base: string };
    location?: { fraction: number[] };
    text?: string;
    /** Viritura tempo extensions (text, showMetronomeMark, showText) */
    _x?: Record<string, unknown>;
  }>;
  /** Viritura global measure extensions */
  virituraGlobal?: Record<string, unknown>;
  /** Part measure events per voice */
  voices?: EventArgs[][];
  /** Full-measure rest (replaces voices with a single fullMeasure sequence) */
  fullMeasure?: { visualDuration?: string; staffPosition?: number };
  /** Clef for this measure */
  clef?: { sign: string; staffPosition: number; glyph?: string; octave?: number; showOctave?: boolean; color?: string };
  /** Multiple/positioned clefs, including mid-measure changes. */
  clefs?: Array<{
    clef: {
      sign: string;
      staffPosition: number;
      glyph?: string;
      octave?: number;
      showOctave?: boolean;
      color?: string;
    };
    position?: { fraction: number[] };
    staff?: number;
  }>;
  /** Standard MNX dynamics */
  dynamics?: Array<{
    id?: string;
    type?: "immediate" | "gradual" | "relative" | "accent";
    value?: string;
    residualValue?: string;
    accentPrefix?: "s" | "r" | "";
    accentSuffix?: "z" | "";
    position: { fraction: number[] };
    glyph?: string;
    glyphs?: string[];
    orient?: "above" | "auto" | "below" | "between";
    prefix?: string;
    staff?: number;
    staffEnd?: number;
    suffix?: string;
    visuallyContinues?: string;
    voice?: string;
    end?: { measure: string; position: { fraction: number[] } };
    wedgeType?: "increasing" | "decreasing";
    relativeValue?: "louder" | "softer";
  }>;
  /** Standard MNX ottavas */
  ottavas?: Array<{
    value: number;
    position: { fraction: number[] };
    end: { measure: string; position: { fraction: number[] } };
  }>;
  /** Standard MNX arpeggio markings */
  arpeggios?: Array<{
    position: { fraction: number[] };
    span: { start: string; end: string };
    direction?: string;
    arrow?: boolean;
  }>;
  /** Standard MNX non-arpeggio markings */
  nonArpeggios?: Array<{ position: { fraction: number[] }; span: { start: string; end: string } }>;
  /** Viritura part measure extensions */
  virituraPartMeasure?: Record<string, unknown>;
}

export interface ScoreArgs {
  measures: MeasureArgs[];
  /** Part name */
  partName?: string;
  /** Number of staves (default 1) */
  staves?: number;
  /** MNX support flags (useBeams, useAccidentalDisplay) */
  support?: { useBeams?: boolean; useAccidentalDisplay?: boolean };
  /** Document-level Viritura extensions (placed in root `_x.viritura`) */
  virituraRoot?: Record<string, unknown>;
}

// ─── Builders ──────────────────────────────────────────────────

function buildNote(args: NoteArgs): Record<string, unknown> {
  const note: Record<string, unknown> = {
    pitch: {
      step: args.step ?? "C",
      octave: args.octave ?? 4,
      ...(args.alter !== undefined && args.alter !== 0 ? { alter: args.alter } : {}),
    },
  };
  if (args.id) note.id = args.id;
  if (args.accidentalDisplay) {
    note.accidentalDisplay = args.accidentalDisplay;
  }
  if (args.ties) {
    note.ties = args.ties;
  }
  return note;
}

function buildEvent(args: EventArgs): Record<string, unknown> {
  const event: Record<string, unknown> = {
    duration: {
      base: args.duration ?? "quarter",
      ...(args.dots ? { dots: args.dots } : {}),
    },
  };

  if (args.id) event.id = args.id;
  if (args.staff !== undefined) event.staff = args.staff;

  if (args.rest) {
    event.rest = args.restStaffPosition !== undefined ? { staffPosition: args.restStaffPosition } : {};
  } else {
    const notes = (args.notes ?? [{ step: "C", octave: 4 }]).map(buildNote);
    // For single-note events, mirror the event id onto the note so that
    // tie targets (which reference note ids in MNX) resolve correctly
    // when callers use the event id as the tie target. Without this,
    // ties silently fail to render when the helper is used.
    if (notes.length === 1 && args.id) {
      (notes[0] as Record<string, unknown>).id = args.id;
    }
    // Add ties to notes if specified
    if (args.ties && notes.length > 0) {
      (notes[0] as Record<string, unknown>).ties = args.ties;
    }
    event.notes = notes;
  }

  // Build markings
  const standardMarkings = args.markings ?? {};
  const virituraMarkings = args.virituraMarkings ?? {};
  const hasStandard = Object.keys(standardMarkings).length > 0;
  const hasViritura = Object.keys(virituraMarkings).length > 0;

  if (hasStandard || hasViritura) {
    const markingsObj: Record<string, unknown> = { ...standardMarkings };
    if (hasViritura) {
      markingsObj._x = { viritura: virituraMarkings };
    }
    event.markings = markingsObj;
  }

  // Native MNX fermata is at event level (since v15).
  if (args.fermata) {
    event.fermata = args.fermata;
  }

  // Viritura event-level extensions (e.g. glissandos)
  if (args.virituraExtensions && Object.keys(args.virituraExtensions).length > 0) {
    event._x = { viritura: args.virituraExtensions };
  }

  // Slurs
  if (args.slurs && args.slurs.length > 0) {
    event.slurs = args.slurs;
  }

  return event;
}

/**
 * Build a complete, valid MNX JSON string from structured args.
 */
export function buildMnx(args: ScoreArgs): string {
  const globalMeasures = args.measures.map((m) => {
    const gm: Record<string, unknown> = {};
    if (m.id) gm.id = m.id;
    if (m.number !== undefined) gm.number = m.number;
    if (m.time) gm.time = m.time;
    if (m.key) gm.key = m.key;
    if (m.barline) gm.barline = m.barline;
    if (m.repeatStart) gm.repeatStart = m.repeatStart === true ? {} : m.repeatStart;
    if (m.repeatEnd) gm.repeatEnd = m.repeatEnd === true ? {} : m.repeatEnd;
    if (m.ending) gm.ending = m.ending;
    if (m.segno) gm.segno = m.segno;
    if (m.fine) gm.fine = m.fine;
    if (m.jump) gm.jump = m.jump;
    if (m.tempos) gm.tempos = m.tempos;
    if (m.virituraGlobal && Object.keys(m.virituraGlobal).length > 0) {
      gm._x = { viritura: m.virituraGlobal };
    }
    return gm;
  });

  const partMeasures = args.measures.map((m, i) => {
    const pm: Record<string, unknown> = {};

    // Clef on first measure (or if explicitly set)
    if (m.clefs && m.clefs.length > 0) {
      pm.clefs = m.clefs;
    } else if (m.clef || i === 0) {
      pm.clefs = [
        {
          clef: m.clef ?? { sign: "G", staffPosition: -2 },
        },
      ];
    }

    // Dynamics
    if (m.dynamics && m.dynamics.length > 0) {
      pm.dynamics = m.dynamics.map((dynamic) => {
        if (dynamic.type) {
          const out = { ...dynamic };
          if (out.glyph) {
            out.glyphs = [out.glyph];
            delete out.glyph;
          }
          return out;
        }
        const group = createDynamicGroup(dynamic.value ?? "mf", {
          fraction: dynamic.position.fraction as [number, number],
        });
        if (dynamic.glyph) group.glyphs = [dynamic.glyph];
        return group;
      });
    }

    // Ottavas
    if (m.ottavas && m.ottavas.length > 0) {
      pm.ottavas = m.ottavas;
    }

    if (m.arpeggios && m.arpeggios.length > 0) {
      pm.arpeggios = m.arpeggios;
    }

    if (m.nonArpeggios && m.nonArpeggios.length > 0) {
      pm.nonArpeggios = m.nonArpeggios;
    }

    // Viritura part measure extensions
    if (m.virituraPartMeasure && Object.keys(m.virituraPartMeasure).length > 0) {
      pm._x = { viritura: m.virituraPartMeasure };
    }

    // Build sequences from voices or fullMeasure
    if (m.fullMeasure) {
      const fm: Record<string, unknown> = {
        visualDuration: { base: m.fullMeasure.visualDuration ?? "whole" },
      };
      if (m.fullMeasure.staffPosition !== undefined) {
        fm.staffPosition = m.fullMeasure.staffPosition;
      }
      pm.sequences = [{ content: [], fullMeasure: fm }];
    } else {
      const voices = m.voices ?? [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]];
      pm.sequences = voices.map((events) => ({
        content: events.map(buildEvent),
      }));
    }

    return pm;
  });

  const mnxMeta: Record<string, unknown> = { version: 1 };
  if (args.support) {
    mnxMeta.support = args.support;
  }

  const doc = {
    mnx: mnxMeta,
    global: { measures: globalMeasures },
    parts: [
      {
        ...(args.partName ? { name: args.partName } : {}),
        ...(args.staves && args.staves > 1 ? { staves: args.staves } : {}),
        measures: partMeasures,
      },
    ],
    ...(args.virituraRoot && Object.keys(args.virituraRoot).length > 0 ? { _x: { viritura: args.virituraRoot } } : {}),
  };

  return JSON.stringify(doc, null, 2);
}

/**
 * Convenience: build MNX for a single measure with a single voice.
 */
export function buildSingleMeasure(
  events: EventArgs[],
  options?: {
    time?: { count: number; unit: number };
    key?: { fifths: number };
    clef?: { sign: string; staffPosition: number; glyph?: string };
    virituraGlobal?: Record<string, unknown>;
    virituraPartMeasure?: Record<string, unknown>;
    dynamics?: MeasureArgs["dynamics"];
    arpeggios?: MeasureArgs["arpeggios"];
    nonArpeggios?: MeasureArgs["nonArpeggios"];
    support?: { useBeams?: boolean; useAccidentalDisplay?: boolean };
  },
): string {
  return buildMnx({
    support: options?.support,
    measures: [
      {
        time: options?.time ?? { count: 4, unit: 4 },
        key: options?.key,
        clef: options?.clef,
        virituraGlobal: options?.virituraGlobal,
        virituraPartMeasure: options?.virituraPartMeasure,
        dynamics: options?.dynamics,
        arpeggios: options?.arpeggios,
        nonArpeggios: options?.nonArpeggios,
        voices: [events],
      },
    ],
  });
}
