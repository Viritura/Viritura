// MNX Parser — parseContent (split from parser.ts)
//
// All schema-defined inputs (sequence, sequence-content, event, grace,
// tuplet, multi-note-tremolo, space, note, kit-note, tie, pitch,
// note-value, lyrics, slur, event-markings, rest, written, accidental-
// display) now consume the generated Raw* types. Vendor-extension
// blocks under `_x.viritura` (glissandos, slur shape overrides, trill,
// ornaments, arpeggio direction, caesura style, fingerings, staccatissimo
// wedge) keep narrow VendorObj casts because the MNX schema deliberately
// leaves vendor dicts opaque.

import type {
  NoteEvent,
  Note,
  KitNote,
  Sequence,
  Duration,
  SequenceContent,
  Tie,
  Markings,
  BreathMarkSymbol,
  Fermata,
  FermataSymbol,
  FermataDuration,
  Orientation,
  UpDownAuto,
  UpDown,
  OrnamentType,
  Trill,
  Slur,
  Glissando,
  GlissandoStyle,
  ArpeggioDirection,
  CaesuraStyle,
  Lyrics,
  LyricLine,
  LyricLineType,
  Grace,
  GraceType,
  TupletDuration,
  Tuplet,
  TupletBracket,
  TupletDisplaySetting,
  MultiNoteTremolo,
  Space,
  AccidentalDisplay,
  AccidentalEnclosureSymbol,
  Pitch,
} from "@viritura/core";
import type { NoteValueBase, StemDirection, Step, Octave } from "@viritura/core";

import type {
  Sequence as RawSequence,
  SequenceContent as RawSequenceContentList,
  Event as RawEvent,
  Grace as RawGrace,
  Tuplet as RawTuplet,
  Space as RawSpace,
  MultiNoteTremolo as RawMultiNoteTremolo,
  Note as RawNote,
  KitNote as RawKitNote,
  Tie as RawTie,
  Pitch as RawPitch,
  NoteValue as RawNoteValue,
  Slur as RawSlur,
  Lyrics as RawLyrics,
  EventMarkings as RawEventMarkings,
  Rest as RawRest,
} from "@viritura/core/raw";
import type {
  EventExtensions as RawEventExt,
  EventMarkingsExtensions as RawEventMarkingsExt,
  SlurExtensions as RawSlurExt,
  NoteExtensions as RawNoteExt,
  Glissando as RawGlissando,
} from "@viritura/core/raw-viritura";

/** A single sequence-content item: discriminated union from the schema. */
type RawSequenceItem = RawSequenceContentList[number];

/** Shape of a tuplet's `inner`/`outer` (note-value-quantity). */
type RawNoteValueQuantity = RawTuplet["inner"];

// ═══════════════════════════════════════════
// Sequences (voices)
// ═══════════════════════════════════════════

export function parseSequences(arr: RawSequence[] | undefined): Sequence[] {
  if (!arr) return [];
  return arr.map(parseSequence);
}

function parseSequence(raw: RawSequence): Sequence {
  const seq: Sequence = {
    content: parseContent(raw.content),
  };
  if (raw.fullMeasure) {
    const fm = raw.fullMeasure;
    seq.fullMeasure = {
      visualDuration: fm.visualDuration ? parseDuration(fm.visualDuration) : { base: "whole" },
    };
    if (fm.staffPosition !== undefined) {
      seq.fullMeasure.staffPosition = fm.staffPosition;
    }
  }
  if (raw.staff !== undefined) seq.staff = raw.staff;
  if (raw.voice !== undefined) seq.voice = raw.voice;
  if (raw.orient !== undefined) seq.orient = raw.orient;
  return seq;
}

function parseContent(arr: RawSequenceContentList | undefined): SequenceContent[] {
  if (!arr) return [];
  return arr.map(parseSequenceContent);
}

function parseSequenceContent(raw: RawSequenceItem): SequenceContent {
  // The discriminator is `type` — required on every variant except `event`,
  // where it's optional (default "event").
  const type = (raw as { type?: string }).type;
  switch (type) {
    case "tuplet":
      return parseTuplet(raw as RawTuplet);
    case "tremolo":
      return parseMultiNoteTremolo(raw as RawMultiNoteTremolo);
    case "grace":
      return parseGrace(raw as RawGrace);
    case "space":
      return parseSpace(raw as RawSpace);
    default:
      return parseEvent(raw as RawEvent);
  }
}

// ═══════════════════════════════════════════
// Tuplet
// ═══════════════════════════════════════════

function parseTupletDuration(raw: RawNoteValueQuantity): TupletDuration {
  return {
    duration: parseDuration(raw.duration),
    multiple: raw.multiple,
  };
}

function parseTuplet(raw: RawTuplet): Tuplet {
  const t: Tuplet = {
    type: "tuplet",
    inner: parseTupletDuration(raw.inner),
    outer: parseTupletDuration(raw.outer),
    content: parseContent(raw.content),
  };
  if (raw.bracket !== undefined) {
    t.bracket = raw.bracket as TupletBracket;
  }
  if (raw.showNumber !== undefined) {
    t.showNumber = raw.showNumber as TupletDisplaySetting;
  }
  if (raw.showValue !== undefined) {
    t.showValue = raw.showValue as TupletDisplaySetting;
  }
  if (raw.orient !== undefined) t.orient = raw.orient;
  return t;
}

// ═══════════════════════════════════════════
// Multi-note tremolo
// ═══════════════════════════════════════════

function parseMultiNoteTremolo(raw: RawMultiNoteTremolo): MultiNoteTremolo {
  const tremolo: MultiNoteTremolo = {
    type: "tremolo",
    content: raw.content.map(parseEvent),
    marks: raw.marks,
    outer: parseTupletDuration(raw.outer),
  };
  if (raw.individualDuration !== undefined) tremolo.individualDuration = parseDuration(raw.individualDuration);
  return tremolo;
}

// ═══════════════════════════════════════════
// Grace notes
// ═══════════════════════════════════════════

function parseGrace(raw: RawGrace): Grace {
  const grace: Grace = {
    type: "grace",
    content: raw.content.map(parseEvent),
  };
  if (raw.graceType !== undefined) grace.graceType = raw.graceType as GraceType;
  if (raw.slash !== undefined) grace.slash = raw.slash;
  if (raw.color) grace.color = raw.color;
  return grace;
}

// ═══════════════════════════════════════════
// Space
// ═══════════════════════════════════════════

function parseSpace(raw: RawSpace): Space {
  return {
    type: "space",
    duration: raw.duration as [number, number],
  };
}

// ═══════════════════════════════════════════
// Events
// ═══════════════════════════════════════════

function parseEvent(raw: RawEvent): NoteEvent {
  const event: NoteEvent = {
    type: "event",
    duration: parseDuration(raw.duration),
  };

  if (raw.id) event.id = raw.id;

  if (typeof raw.staff === "number") event.staff = raw.staff;

  if (raw.orient !== undefined) event.orient = raw.orient;

  if (raw.rest !== undefined) {
    const restRaw: RawRest = raw.rest;
    const rest: { staffPosition?: number } = {};
    if (typeof restRaw.staffPosition === "number") {
      rest.staffPosition = restRaw.staffPosition;
    }
    event.rest = rest;
  }

  if (raw.notes) {
    event.notes = parseNotes(raw.notes);
  }

  if (raw.kitNotes) {
    event.kitNotes = raw.kitNotes.map(parseKitNote);
  }

  if (raw.slurs) {
    event.slurs = raw.slurs.map(parseSlur);
  }

  if (raw.markings) {
    event.markings = parseMarkings(raw.markings);
  }

  // Native MNX fermata (event-level since v15).
  if (raw.fermata !== undefined) {
    const f = raw.fermata;
    const fermata: Fermata = {};
    if (f.symbol) fermata.symbol = f.symbol as FermataSymbol;
    if (f.duration) fermata.duration = f.duration as FermataDuration;
    if (f.orient) fermata.orient = f.orient;
    if (f.pointing) fermata.pointing = f.pointing;
    event.fermata = fermata;
  }

  if (raw.lyrics) {
    event.lyrics = parseLyrics(raw.lyrics);
  }

  if (raw.stemDirection) {
    event.stemDirection = raw.stemDirection as StemDirection;
  }

  // _x.viritura vendor extensions on event
  const viritura = raw._x?.["viritura"] as RawEventExt | undefined;
  if (viritura?.glissandos) {
    event.glissandos = viritura.glissandos.map(parseGlissando);
  }

  return event;
}

// ═══════════════════════════════════════════
// Markings
// ═══════════════════════════════════════════

// Helper: parse the orient field if present.
function parseOrient(o: { orient?: Orientation } | undefined): { orient?: Orientation } {
  if (o && o.orient) return { orient: o.orient };
  return {};
}

// Parse the standard MNX-spec markings on a marking container.
function parseStandardMarkings(raw: RawEventMarkings, m: Markings): void {
  if (raw.staccato !== undefined) m.staccato = parseOrient(raw.staccato);
  if (raw.staccatissimo !== undefined) m.staccatissimo = parseOrient(raw.staccatissimo);
  if (raw.spiccato !== undefined) m.spiccato = parseOrient(raw.spiccato);
  if (raw.tenuto !== undefined) m.tenuto = parseOrient(raw.tenuto);
  if (raw.accent !== undefined) {
    // MNX spec: accent has only `orient` — no `pointing`.
    m.accent = parseOrient(raw.accent);
  }
  if (raw.strongAccent !== undefined) {
    const sa = raw.strongAccent;
    m.strongAccent = parseOrient(sa);
    if (sa.pointing) m.strongAccent.pointing = sa.pointing as UpDownAuto;
  }
  if (raw.tremolo !== undefined) {
    const t = raw.tremolo;
    m.tremolo = { marks: t.marks, ...parseOrient(t) };
  }
  if (raw.softAccent !== undefined) m.softAccent = parseOrient(raw.softAccent);
  if (raw.stress !== undefined) m.stress = parseOrient(raw.stress);
  if (raw.unstress !== undefined) m.unstress = parseOrient(raw.unstress);
  if (raw.breath !== undefined) {
    const b = raw.breath;
    m.breath = parseOrient(b);
    if (b.symbol) m.breath.symbol = b.symbol as BreathMarkSymbol;
  }
  if (raw.bowDirection !== undefined) {
    const bd = raw.bowDirection;
    m.bowDirection = {
      direction: bd.direction as UpDown,
      ...parseOrient(bd),
    };
  }
}

// Parse the `_x.viritura` vendor extensions on a marking container.
// NOTE: schema does NOT define `arpeggio` on event-markings-extensions, but
// existing fixtures use it (legacy shape). Read it through a narrow cast.
function parseVirituraMarkings(viritura: RawEventMarkingsExt, m: Markings): void {
  if (viritura.staccatissimoWedge !== undefined) {
    m.staccatissimoWedge = parseOrient(viritura.staccatissimoWedge);
  }
  if (viritura.trill !== undefined) {
    const t = viritura.trill;
    const trill: Trill = {};
    if (t.accidental !== undefined) trill.accidental = t.accidental;
    m.trill = trill;
  }
  if (viritura.ornaments !== undefined) {
    m.ornaments = viritura.ornaments.map((o) => o as OrnamentType);
  }
  const arpeggio = (viritura as { arpeggio?: { direction?: string } }).arpeggio;
  if (arpeggio !== undefined) {
    m.arpeggio = {};
    if (arpeggio.direction) m.arpeggio.direction = arpeggio.direction as ArpeggioDirection;
  }
  if (viritura.caesura !== undefined) {
    m.caesura = {};
    if (viritura.caesura.style) m.caesura.style = viritura.caesura.style as CaesuraStyle;
  }
  if (viritura.fingerings !== undefined) {
    m.fingerings = viritura.fingerings.map((f) => ({ finger: f.finger }));
  }
}

function parseMarkings(raw: RawEventMarkings): Markings {
  const m: Markings = {};
  parseStandardMarkings(raw, m);
  const viritura = raw._x?.["viritura"] as RawEventMarkingsExt | undefined;
  if (viritura) parseVirituraMarkings(viritura, m);
  return m;
}

// ═══════════════════════════════════════════
// Lyrics
// ═══════════════════════════════════════════

function parseLyrics(raw: RawLyrics): Lyrics {
  const lyrics: Lyrics = {};
  if (raw.lines) {
    const linesObj = raw.lines;
    const lines: Record<string, LyricLine> = {};
    for (const key of Object.keys(linesObj)) {
      const lineRaw = linesObj[key]!;
      const line: LyricLine = { text: lineRaw.text };
      if (lineRaw.type !== undefined) line.type = lineRaw.type as LyricLineType;
      lines[key] = line;
    }
    lyrics.lines = lines;
  }
  return lyrics;
}

// ═══════════════════════════════════════════
// Slurs
// ═══════════════════════════════════════════

function parseSlur(raw: RawSlur): Slur {
  const slur: Slur = { target: raw.target };
  if (raw.side) slur.side = raw.side;
  if (raw.sideEnd) slur.sideEnd = raw.sideEnd;
  if (raw.lineType) slur.lineType = raw.lineType as "solid" | "dashed" | "dotted";
  if (raw.startNote) slur.startNote = raw.startNote;
  if (raw.endNote) slur.endNote = raw.endNote;
  // _x.viritura.shape vendor extension: per-handle bezier overrides for engrave mode.
  const viritura = raw._x?.["viritura"] as RawSlurExt | undefined;
  const shapeObj = viritura?.shape;
  if (shapeObj) {
    const shape: NonNullable<Slur["shape"]> = {};
    const readPair = (v: number[] | undefined): [number, number] | undefined => {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") {
        return [v[0], v[1]];
      }
      return undefined;
    };
    const p0 = readPair(shapeObj.p0);
    if (p0) shape.p0 = p0;
    const p1 = readPair(shapeObj.p1);
    if (p1) shape.p1 = p1;
    const p2 = readPair(shapeObj.p2);
    if (p2) shape.p2 = p2;
    const p3 = readPair(shapeObj.p3);
    if (p3) shape.p3 = p3;
    if (shape.p0 || shape.p1 || shape.p2 || shape.p3) slur.shape = shape;
  }
  return slur;
}

// ═══════════════════════════════════════════
// Glissandos (vendor extension — no schema)
// ═══════════════════════════════════════════

function parseGlissando(raw: RawGlissando): Glissando {
  const gliss: Glissando = { target: raw.target };
  if (raw.style) gliss.style = raw.style as GlissandoStyle;
  if (raw.text) gliss.text = raw.text;
  return gliss;
}

// ═══════════════════════════════════════════
// Notes
// ═══════════════════════════════════════════

function parseNotes(arr: RawNote[]): Note[] {
  return arr.map(parseNote);
}

function parseNote(raw: RawNote): Note {
  const note: Note = {
    pitch: parsePitch(raw.pitch),
  };

  if (raw.id) note.id = raw.id;

  if (raw.ties) {
    note.ties = raw.ties.map(parseTie);
  }

  if (typeof raw.staff === "number") note.staff = raw.staff;

  if (raw.accidentalDisplay) {
    const ad = raw.accidentalDisplay;
    const display: AccidentalDisplay = { show: ad.show };
    if (ad.force !== undefined) display.force = ad.force;
    if (ad.enclosure) {
      display.enclosure = { symbol: ad.enclosure.symbol as AccidentalEnclosureSymbol };
    }
    note.accidentalDisplay = display;
  }

  if (raw.written) {
    note.written = {};
    if (raw.written.diatonicDelta !== undefined) note.written.diatonicDelta = raw.written.diatonicDelta;
  }

  // _x.viritura.notehead: per-note notehead-shape override (MNX issue #249).
  const viritura = raw._x?.["viritura"] as RawNoteExt | undefined;
  if (viritura?.notehead) note.notehead = viritura.notehead;

  return note;
}

function parseKitNote(raw: RawKitNote): KitNote {
  const kn: KitNote = {
    kitComponent: raw.kitComponent,
  };
  if (raw.id) kn.id = raw.id;
  if (typeof raw.staff === "number") kn.staff = raw.staff;
  if (raw.ties) {
    kn.ties = raw.ties.map(parseTie);
  }
  if (raw.perform !== undefined) {
    const p = raw.perform;
    const perform: { id?: string } = {};
    if (typeof p.id === "string") perform.id = p.id;
    kn.perform = perform;
  }
  return kn;
}

function parseTie(raw: RawTie): Tie {
  const tie: Tie = {};
  if (raw.target) tie.target = raw.target;
  if (raw.targetType) tie.targetType = raw.targetType;
  if (raw.side) tie.side = raw.side;
  if (raw.lv !== undefined) tie.lv = raw.lv;
  return tie;
}

// ═══════════════════════════════════════════
// Pitch
// ═══════════════════════════════════════════

function parsePitch(raw: RawPitch): Pitch {
  const pitch: Pitch = {
    step: (raw.step as Step) ?? "C",
    octave: (raw.octave as Octave) ?? 4,
  };
  if (raw.alter !== undefined) pitch.alter = raw.alter;
  return pitch;
}

// ═══════════════════════════════════════════
// Duration (note-value)
// ═══════════════════════════════════════════

function parseDuration(raw: RawNoteValue): Duration {
  const dur: Duration = {
    base: (raw.base as NoteValueBase) ?? "quarter",
  };
  if (raw.dots !== undefined) dur.dots = raw.dots;
  return dur;
}
