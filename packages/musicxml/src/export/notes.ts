import {
  clefReferencePitch,
  type DiagnosticCollector,
  type KitNote,
  type Note,
  type Notehead,
  type Score,
} from "@viritura/core";
import type { ExportSequence, PartPlan } from "./types";
import { displayInterval, writtenPitch } from "./pitch";
import { displayTransposition, instrumentAt, instrumentNoteId, sourcePosition } from "./instruments";
import {
  articulationElements,
  caesuraValue,
  fermataElement,
  ornamentElements,
  technicalElements,
  tupletElement,
} from "./markings";
import { add, compare, divide, durationOf, noteType, rational, ticks, type TimedEvent } from "./rhythm";
import type { SpannerIndex } from "./spanners";
import { node, placement, type XmlContext, type XmlElement } from "./xml";

export interface NoteContext {
  xml: XmlContext;
  score: Score;
  plan: PartPlan;
  measureIndex: number;
  sequence: ExportSequence;
  spanners: SpannerIndex;
  divisions: bigint;
  diagnostics: DiagnosticCollector;
  useWritten: boolean;
}

const HEADS: Record<Notehead["shape"], string> = {
  oval: "normal",
  x: "x",
  diamond: "diamond",
  triangle: "triangle",
  triangleDown: "inverted triangle",
  slash: "slash",
  plus: "plus",
  circleX: "circle-x",
  circled: "circled",
  slashed: "slashed",
  backSlashed: "back slashed",
  square: "square",
  custom: "other",
};

function displayPosition(context: NoteContext, position: number, staff: number, onset: TimedEvent): XmlElement[] {
  let reference = 34;
  const local = sourcePosition(context.plan, context.measureIndex, staff, onset.position);
  for (let mi = 0; mi <= context.measureIndex; mi++) {
    for (const change of context.plan.selection.part.measures[mi]?.clefs ?? []) {
      if (
        (change.staff ?? 1) === staff &&
        (mi < context.measureIndex || compare(rational(...(change.position?.fraction ?? [0, 1])), local) <= 0)
      ) {
        reference = clefReferencePitch(change.clef) - change.clef.staffPosition;
      }
    }
  }
  const diatonic = reference + position;
  const step = "CDEFGAB"[((diatonic % 7) + 7) % 7]!;
  const octave = Math.floor(diatonic / 7);
  return [node(context.xml, "display-step", step), node(context.xml, "display-octave", octave)];
}

function pitchElement(context: NoteContext, timed: TimedEvent, note: Note | KitNote | undefined): XmlElement {
  if (!note) {
    const rest = timed.event.rest;
    return node(
      context.xml,
      "rest",
      rest?.staffPosition === undefined
        ? []
        : displayPosition(context, rest.staffPosition, context.sequence.sourceStaff, timed),
      { measure: timed.fullMeasure ? "yes" : undefined },
    );
  }
  if ("kitComponent" in note) {
    const component = context.plan.selection.part.kit?.[note.kitComponent];
    if (!component) throw new Error(`Unknown percussion component "${note.kitComponent}".`);
    return node(context.xml, "unpitched", [
      node(context.xml, "display-step", "CDEFGAB"[(((34 + component.staffPosition) % 7) + 7) % 7]!),
      node(context.xml, "display-octave", Math.floor((34 + component.staffPosition) / 7)),
    ]);
  }
  const state = instrumentAt(context.plan, context.measureIndex, timed.position);
  const transposition = displayTransposition(state, context.useWritten);
  const measure = context.plan.measures[context.measureIndex]!;
  const pitch = writtenPitch(note, displayInterval(measure.key.atonal ? 0 : measure.key.fifths, transposition));
  if (pitch.octave < 0 || pitch.octave > 9) throw new Error("Written pitch is outside MusicXML's octave range.");
  return node(context.xml, "pitch", [
    node(context.xml, "step", pitch.step),
    pitch.alter ? node(context.xml, "alter", pitch.alter) : undefined,
    node(context.xml, "octave", pitch.octave),
  ]);
}

function accidentalElement(context: NoteContext, timed: TimedEvent, note: Note): XmlElement | undefined {
  if (!note.accidentalDisplay?.show) return undefined;
  const transpose = displayTransposition(
    instrumentAt(context.plan, context.measureIndex, timed.position),
    context.useWritten,
  );
  const alter = writtenPitch(
    note,
    displayInterval(context.plan.measures[context.measureIndex]!.key.fifths, transpose),
  ).alter;
  const values: Record<number, string> = {
    [-2]: "flat-flat",
    [-1]: "flat",
    0: "natural",
    1: "sharp",
    2: "double-sharp",
    3: "triple-sharp",
    [-3]: "triple-flat",
  };
  const value = values[alter];
  if (!value) throw new Error(`An explicit accidental with alteration ${alter} has no MusicXML spelling.`);
  return node(context.xml, "accidental", value, {
    cautionary: note.accidentalDisplay.force ? "yes" : undefined,
    parentheses: note.accidentalDisplay.enclosure?.symbol === "parentheses" ? "yes" : undefined,
    bracket: note.accidentalDisplay.enclosure?.symbol === "brackets" ? "yes" : undefined,
  });
}

function globalCaesura(context: NoteContext, timed: TimedEvent): XmlElement | undefined {
  const measure = context.plan.measures[context.measureIndex]!;
  if (!measure.global.caesura || timed.grace || timed.event.markings?.caesura) return undefined;
  const final = measure.sequences
    .filter((sequence) => sequence.sourceStaff === context.sequence.sourceStaff)
    .flatMap((sequence) => sequence.events)
    .filter((event) => !event.grace)
    .sort((a, b) => compare(add(a.position, a.duration), add(b.position, b.duration)))
    .at(-1);
  return final === timed
    ? node(context.xml, "articulations", [
        node(
          context.xml,
          "caesura",
          caesuraValue(measure.global.caesura, context.diagnostics, `/global/measures/${context.measureIndex}/caesura`),
        ),
      ])
    : undefined;
}

function notationElements(
  context: NoteContext,
  timed: TimedEvent,
  note: Note | KitNote | undefined,
  first: boolean,
): XmlElement[] {
  const elements: XmlElement[] = [];
  const ornaments = first
    ? ornamentElements(
        context.xml,
        timed,
        context.diagnostics,
        `/parts/${context.plan.selection.sourceIndex}/measures/${context.measureIndex}`,
      )
    : [];
  for (const boundary of context.spanners.events.get(timed.event) ?? []) {
    if (boundary.note ? boundary.note !== note : boundary.noteId ? boundary.noteId !== note?.id : !first) continue;
    const element = node(context.xml, boundary.name, boundary.text, boundary.attributes);
    if (boundary.ornament) ornaments.push(element);
    else elements.push(element);
  }
  for (const tie of note ? (context.spanners.ties.get(note) ?? []) : []) {
    elements.push(node(context.xml, "tied", undefined, { type: tie.type, placement: placement(tie.side) }));
  }
  elements.push(
    ...articulationElements(
      context.xml,
      first ? timed.event : { ...timed.event, markings: undefined },
      context.diagnostics,
      `/parts/${context.plan.selection.sourceIndex}/measures/${context.measureIndex}`,
      note && "pitch" in note ? note : undefined,
    ),
  );
  if (first) {
    const caesura = globalCaesura(context, timed);
    if (caesura) elements.push(caesura);
    if (timed.event.fermata) {
      elements.push(fermataElement(context.xml, timed.event.fermata));
      const marker = timed.event.fermata._x?.viritura;
      if (marker) {
        elements.push(
          node(context.xml, "other-notation", `viritura-fermata:${JSON.stringify(marker)}`, {
            type: "single",
            "print-object": "no",
          }),
        );
      }
    }
    elements.push(...technicalElements(context.xml, timed.event));
    for (const boundary of timed.tuplets) elements.push(tupletElement(context.xml, boundary));
  }
  if (timed.event.markings?.arpeggio)
    elements.push(node(context.xml, "arpeggiate", undefined, { direction: timed.event.markings.arpeggio.direction }));
  if (ornaments.length) elements.push(node(context.xml, "ornaments", ornaments));
  return elements.length ? [node(context.xml, "notations", elements)] : [];
}

function lyricElements(context: NoteContext, timed: TimedEvent): XmlElement[] {
  const lines = timed.event.lyrics?.lines ?? {};
  const boundaries = context.spanners.lyrics.get(timed.event);
  const ids = new Set([...Object.keys(lines), ...(boundaries?.keys() ?? [])]);
  const syllables = { start: "begin", middle: "middle", end: "end", whole: "single" } as const;
  return [...ids].map((id) => {
    const line = lines[id];
    const metadata = context.score.global.lyrics?.lineMetadata?.[id];
    const type = boundaries?.get(id);
    return node(
      context.xml,
      "lyric",
      [
        line?.type ? node(context.xml, "syllabic", syllables[line.type]) : undefined,
        line ? node(context.xml, "text", line.text, { "xml:lang": metadata?.lang }) : undefined,
        type || (line?.extender?.show && !line.extender.target)
          ? node(context.xml, "extend", undefined, { type: type === "single" ? undefined : type })
          : undefined,
      ],
      { number: id, name: metadata?.label },
    );
  });
}

function noteProperties(context: NoteContext, timed: TimedEvent, note: Note | KitNote | undefined) {
  const state = instrumentAt(context.plan, context.measureIndex, timed.position);
  const ties = note ? (context.spanners.ties.get(note) ?? []) : [];
  const scale =
    timed.grace || timed.fullMeasure ? rational(1) : divide(timed.duration, durationOf(timed.event.duration));
  const sourceStaff = note?.staff ?? timed.event.staff ?? context.sequence.sourceStaff;
  const staff = context.plan.selection.staves.get(sourceStaff) ?? context.sequence.staff;
  if (!context.plan.selection.staves.has(sourceStaff))
    context.diagnostics.warn(
      `/parts/${context.plan.selection.sourceIndex}`,
      "A cross-staff note is placed on its source voice's staff in this extract.",
      "musicxml-cross-staff-extract",
    );
  const head =
    note?.notehead ??
    (note && "kitComponent" in note ? context.plan.selection.part.kit?.[note.kitComponent]?.notehead : undefined);
  return { state, ties, scale, staff, head };
}

export function eventNotes(context: NoteContext, timed: TimedEvent): XmlElement[] {
  if (timed.grace?.graceType && context.sequence.events.find((event) => event.grace === timed.grace) === timed)
    context.diagnostics.warn(
      "",
      "Grace-note playback timing is chosen by the receiving application.",
      "musicxml-grace-timing",
    );
  const notes: (Note | KitNote | undefined)[] = [...(timed.event.notes ?? []), ...(timed.event.kitNotes ?? [])];
  if (notes.length === 0) notes.push(undefined);
  const type = noteType(timed.event.duration);
  if (!type)
    context.diagnostics.warn(
      `/parts/${context.plan.selection.sourceIndex}/measures/${context.measureIndex}`,
      `MusicXML cannot spell ${timed.event.duration.base} noteheads; exact durations are retained.`,
      "musicxml-note-value",
    );
  return notes.map((note, i) => {
    const { state, ties, scale, staff, head } = noteProperties(context, timed, note);
    return node(
      context.xml,
      "note",
      [
        timed.grace
          ? node(context.xml, "grace", undefined, {
              slash: timed.grace.slash === undefined ? undefined : timed.grace.slash ? "yes" : "no",
            })
          : undefined,
        i > 0 ? node(context.xml, "chord") : undefined,
        pitchElement(context, timed, note),
        !timed.grace ? node(context.xml, "duration", ticks(timed.duration, context.divisions)) : undefined,
        ...[...new Map(ties.filter((tie) => tie.type !== "let-ring").map((tie) => [tie.type, tie])).values()]
          .sort((a) => (a.type === "stop" ? -1 : 1))
          .map((tie) => node(context.xml, "tie", undefined, { type: tie.type })),
        note
          ? node(context.xml, "instrument", undefined, { id: instrumentNoteId(context.plan, note, state) })
          : undefined,
        node(context.xml, "voice", context.sequence.voice),
        type ? node(context.xml, "type", type) : undefined,
        ...Array.from({ length: timed.event.duration.dots ?? 0 }, () => node(context.xml, "dot")),
        note && "pitch" in note ? accidentalElement(context, timed, note) : undefined,
        scale.n !== scale.d && !timed.grace
          ? node(context.xml, "time-modification", [
              node(context.xml, "actual-notes", String(scale.d)),
              node(context.xml, "normal-notes", String(scale.n)),
            ])
          : undefined,
        timed.event.stemDirection ? node(context.xml, "stem", timed.event.stemDirection) : undefined,
        head ? node(context.xml, "notehead", HEADS[head.shape], { smufl: head.glyph }) : undefined,
        node(context.xml, "staff", staff),
        ...(i === 0 ? (context.spanners.beams.get(timed.event) ?? []) : []).map((beam) =>
          node(context.xml, "beam", beam.value, { number: beam.number }),
        ),
        ...notationElements(context, timed, note, i === 0),
        ...(i === 0 ? lyricElements(context, timed) : []),
      ],
      { color: timed.grace?.color },
    );
  });
}
