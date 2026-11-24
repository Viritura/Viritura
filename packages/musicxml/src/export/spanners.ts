import {
  pitchToMidi,
  type DiagnosticCollector,
  type KitNote,
  type Note,
  type NoteEvent,
  type Tie,
} from "@viritura/core";
import type { PartPlan } from "./types";
import { compare, type Rational } from "./rhythm";
import type { XmlAttributes } from "./xml";

export interface Boundary {
  name: string;
  attributes: XmlAttributes;
  text?: string;
  noteId?: string;
  note?: Note | KitNote;
  ornament?: boolean;
}

export interface TieBoundary {
  type: "start" | "stop" | "let-ring";
  side?: string;
}

export interface SpannerIndex {
  events: Map<NoteEvent, Boundary[]>;
  ties: Map<Note | KitNote, TieBoundary[]>;
  beams: Map<NoteEvent, { number: number; value: string }[]>;
  lyrics: Map<NoteEvent, Map<string, "start" | "stop" | "single">>;
}

interface EventLocation {
  event: NoteEvent;
  measure: number;
  position: Rational;
  voice: string;
  grace: boolean;
}

interface NoteLocation extends EventLocation {
  note: Note | KitNote;
}

interface SpanRequest {
  start: EventLocation;
  end: EventLocation;
  name: string;
  attributes?: XmlAttributes;
  text?: string;
  startNote?: string;
  endNote?: string;
  ornament?: boolean;
}

function locationCompare(a: EventLocation, b: EventLocation): number {
  return a.measure - b.measure || compare(a.position, b.position);
}

function noteKey(note: Note | KitNote): string {
  return "pitch" in note ? `${note.pitch.step}:${note.pitch.octave}:${note.pitch.alter ?? 0}` : note.kitComponent;
}

function push<T, V>(map: Map<T, V[]>, key: T, value: V): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function indexTies(
  notes: NoteLocation[],
  byId: ReadonlyMap<string, NoteLocation>,
  output: SpannerIndex,
  diagnostics: DiagnosticCollector,
  pointer: string,
): void {
  const addTie = (source: NoteLocation, tie: Tie) => {
    if (tie.lv) {
      push(output.ties, source.note, { type: "let-ring", side: tie.side });
      return;
    }
    const target = tie.target
      ? byId.get(tie.target)
      : notes.find(
          (candidate) =>
            locationCompare(candidate, source) > 0 &&
            candidate.voice === source.voice &&
            noteKey(candidate.note) === noteKey(source.note),
        );
    if (!target) {
      diagnostics.warn(
        pointer,
        "A tie's target is absent from this score/part extract; the tie is not exported.",
        "musicxml-tie-target",
      );
      return;
    }
    if (noteKey(source.note) !== noteKey(target.note))
      throw new Error("A tie connects notes with different sounding pitches.");
    if (tie.targetType && tie.targetType !== "nextNote") {
      diagnostics.warn(
        pointer,
        `MusicXML cannot fully retain ${tie.targetType} tie routing; the written tie endpoints are retained.`,
        "musicxml-tie-routing",
      );
    }
    push(output.ties, source.note, { type: "start", side: tie.side });
    push(output.ties, target.note, { type: "stop", side: tie.side });
  };
  for (const location of notes) for (const tie of location.note.ties ?? []) addTie(location, tie);
}

function indexSpans(
  events: readonly EventLocation[],
  byId: ReadonlyMap<string, EventLocation>,
  output: SpannerIndex,
  diagnostics: DiagnosticCollector,
  pointer: string,
): void {
  const requests: SpanRequest[] = [];
  const add = (start: EventLocation, target: string, span: Omit<SpanRequest, "start" | "end">) => {
    const end = byId.get(target);
    if (!end || locationCompare(end, start) < 0) {
      diagnostics.warn(
        pointer,
        `${span.name} target is outside the extract or precedes its start; this line is not exported.`,
        "musicxml-span-target",
      );
      return;
    }
    requests.push({ start, end, ...span });
  };
  for (const location of events) {
    for (const slur of location.event.slurs ?? []) {
      add(location, slur.target, {
        name: "slur",
        attributes: {
          placement: slur.side === "up" ? "above" : slur.side === "down" ? "below" : undefined,
          "line-type": slur.lineType,
        },
        startNote: slur.startNote,
        endNote: slur.endNote,
      });
      if (slur.shape)
        diagnostics.info(
          pointer,
          "Manual slur handle adjustments are reflowed by the receiving application.",
          "musicxml-slur-shape",
        );
    }
    for (const glissando of location.event.glissandos ?? []) {
      add(location, glissando.target, {
        name: glissando.kind === "portamento" ? "slide" : "glissando",
        attributes: { "line-type": glissando.style === "straight" ? "solid" : (glissando.style ?? "wavy") },
        text: glissando.showText === false ? undefined : glissando.text,
      });
      if (glissando.playbackType)
        diagnostics.warn(
          pointer,
          "Glissando playback interpolation is chosen by the receiving application.",
          "musicxml-glissando-playback",
        );
    }
    const trill = location.event.markings?.trill;
    if (trill?.extension) {
      add(location, trill.extension.target, { name: "wavy-line", ornament: true });
      if (trill.extension.targetEdge === "end")
        diagnostics.warn(pointer, "Trill line ends at the target note's onset in MusicXML.", "musicxml-trill-end");
    }
  }
  const active = new Map<string, EventLocation[]>();
  for (const request of requests.sort((a, b) => locationCompare(a.start, b.start))) {
    const endings = active.get(request.name) ?? [];
    let slot = endings.findIndex((end) => locationCompare(end, request.start) <= 0);
    if (slot < 0) slot = endings.length;
    if (slot >= 16)
      throw new Error(`More than 16 simultaneous ${request.name} lines cannot be represented in MusicXML.`);
    endings[slot] = request.end;
    active.set(request.name, endings);
    push(output.events, request.start.event, {
      name: request.name,
      attributes: { ...request.attributes, number: slot + 1, type: "start" },
      text: request.text,
      noteId: request.startNote,
      ornament: request.ornament,
    });
    push(output.events, request.end.event, {
      name: request.name,
      attributes: { ...request.attributes, number: slot + 1, type: "stop" },
      noteId: request.endNote,
      ornament: request.ornament,
    });
  }
}

function indexLyrics(
  events: readonly EventLocation[],
  byId: ReadonlyMap<string, EventLocation>,
  output: SpannerIndex,
  diagnostics: DiagnosticCollector,
  pointer: string,
): void {
  const set = (event: NoteEvent, line: string, type: "start" | "stop" | "single") => {
    const lines = output.lyrics.get(event) ?? new Map();
    lines.set(line, type);
    output.lyrics.set(event, lines);
  };
  for (const { event } of events) {
    for (const [line, lyric] of Object.entries(event.lyrics?.lines ?? {})) {
      const target = lyric.extender?.target ? byId.get(lyric.extender.target) : undefined;
      if (lyric.extender?.target && lyric.extender.show !== false && !target)
        diagnostics.warn(
          pointer,
          "A lyric extender's target is absent from this extract; the extender is not exported.",
          "musicxml-lyric-target",
        );
      if (lyric.extender?.show !== false && target) {
        if (target.event === event) set(event, line, "single");
        else {
          set(event, line, "start");
          set(target.event, line, "stop");
        }
      }
    }
  }
}

function indexBeams(
  plan: PartPlan,
  byId: ReadonlyMap<string, EventLocation>,
  output: SpannerIndex,
  diagnostics: DiagnosticCollector,
): void {
  const walk = (
    beam: NonNullable<PartPlan["selection"]["part"]["measures"][number]["beams"]>[number],
    level: number,
  ) => {
    if (level > 8) {
      diagnostics.warn(
        "",
        "MusicXML supports at most eight beam levels; deeper beams are omitted without changing durations.",
        "musicxml-beam-level",
      );
      return;
    }
    const members = beam.events
      .map((id) => byId.get(id))
      .filter((member): member is EventLocation => member !== undefined);
    members.forEach((member, i) =>
      push(output.beams, member.event, {
        number: level,
        value:
          members.length === 1
            ? beam.direction === "left"
              ? "backward hook"
              : "forward hook"
            : i === 0
              ? "begin"
              : i === members.length - 1
                ? "end"
                : "continue",
      }),
    );
    for (const child of beam.beams ?? []) walk(child, level + 1);
  };
  for (const measure of plan.selection.part.measures) for (const beam of measure.beams ?? []) walk(beam, 1);
}

export function buildSpanners(plan: PartPlan, diagnostics: DiagnosticCollector): SpannerIndex {
  const output: SpannerIndex = { events: new Map(), ties: new Map(), beams: new Map(), lyrics: new Map() };
  const events: EventLocation[] = plan.measures.flatMap((measure, mi) =>
    measure.sequences.flatMap((sequence) =>
      sequence.events.map((timed) => ({
        event: timed.event,
        measure: mi,
        position: timed.position,
        voice: sequence.voice,
        grace: timed.grace !== undefined,
      })),
    ),
  );
  const notes: NoteLocation[] = events.flatMap((location) =>
    [...(location.event.notes ?? []), ...(location.event.kitNotes ?? [])].map((note) => ({ ...location, note })),
  );
  const eventIds = new Map<string, EventLocation>();
  const noteIds = new Map<string, NoteLocation>();
  for (const location of events) {
    const id = location.event.id;
    if (!id) continue;
    if (eventIds.has(id)) throw new Error(`Duplicate event ID "${id}" in MusicXML export.`);
    eventIds.set(id, location);
  }
  for (const location of notes) {
    const id = location.note.id;
    if (!id) continue;
    if (noteIds.has(id)) throw new Error(`Duplicate note ID "${id}" in MusicXML export.`);
    noteIds.set(id, location);
  }
  const pointer = `/parts/${plan.selection.sourceIndex}`;
  indexTies(notes, noteIds, output, diagnostics, pointer);
  indexSpans(events, eventIds, output, diagnostics, pointer);
  indexLyrics(events, eventIds, output, diagnostics, pointer);
  indexBeams(plan, eventIds, output, diagnostics);
  for (const measure of plan.selection.part.measures) {
    for (const [index, arpeggio] of (measure.arpeggios ?? []).entries()) {
      if (index >= 16) throw new Error("More than 16 simultaneous arpeggios cannot be represented in MusicXML.");
      const start = noteIds.get(arpeggio.span.start);
      const end = noteIds.get(arpeggio.span.end);
      if (!start || !end) {
        diagnostics.warn(pointer, "Arpeggio endpoints are absent from this extract.", "musicxml-arpeggio-target");
        continue;
      }
      if (start.measure !== end.measure || compare(start.position, end.position) !== 0)
        throw new Error("Arpeggio endpoints must be simultaneous.");
      if (!("pitch" in start.note) || !("pitch" in end.note)) {
        diagnostics.warn(
          pointer,
          "Percussion arpeggio ranges are not portable to MusicXML.",
          "musicxml-arpeggio-percussion",
        );
        continue;
      }
      const pitches = [pitchToMidi(start.note.pitch), pitchToMidi(end.note.pitch)];
      for (const location of notes.filter(
        (location) =>
          location.measure === start.measure &&
          location.grace === start.grace &&
          compare(location.position, start.position) === 0 &&
          "pitch" in location.note &&
          pitchToMidi(location.note.pitch) >= Math.min(...pitches) &&
          pitchToMidi(location.note.pitch) <= Math.max(...pitches),
      )) {
        push(output.events, location.event, {
          name: "arpeggiate",
          note: location.note,
          attributes: { number: index + 1, direction: arpeggio.direction === "auto" ? undefined : arpeggio.direction },
        });
      }
    }
    for (const bracket of measure.nonArpeggios ?? []) {
      for (const [id, type] of [
        [bracket.span.start, "bottom"],
        [bracket.span.end, "top"],
      ] as const) {
        const target = noteIds.get(id);
        if (target)
          push(output.events, target.event, { name: "non-arpeggiate", noteId: id, attributes: { number: 1, type } });
        else
          diagnostics.warn(pointer, "Chord bracket endpoint is absent from this extract.", "musicxml-arpeggio-target");
      }
    }
  }
  return output;
}
