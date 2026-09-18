import { DURATION_BEATS, type Duration, type Markings, type NoteEvent, type SequenceContent } from "@viritura/core";
import type { ClipboardSelection } from "../../commands/clipboardCommands";
import type { CapturedChordSymbol, CapturedDynamic, ClipboardTrack } from "../ClipboardFragment";
import { MuseScoreConversionError, unsupported } from "./errors";
import {
  ZERO,
  add,
  compare,
  formatFraction,
  fraction,
  fromTuple,
  isZero,
  multiply,
  subtract,
  type Fraction,
} from "./fractions";
import { serializeHarmony } from "./harmony";
import { midiFromPitch, tpcFromPitch } from "./pitch";
import { escapeXml } from "./xml";

interface MuseScoreWriteResult {
  xml: string | null;
  warning?: string;
}

interface ExportTrack extends ClipboardTrack {
  staff: number;
  voice: number;
}

interface Annotation {
  offset: Fraction;
  xml: string;
}

interface WriteState {
  staff: number;
  voice: number;
  time: Fraction;
}

const DURATION_NAMES: Partial<Record<Duration["base"], string>> = {
  longa: "longa",
  breve: "breve",
  whole: "whole",
  half: "half",
  quarter: "quarter",
  eighth: "eighth",
  "16th": "16th",
  "32nd": "32nd",
  "64th": "64th",
  "128th": "128th",
  "256th": "256th",
  "512th": "512th",
  "1024th": "1024th",
};

function durationAsWhole(duration: Duration): Fraction {
  let result = fraction(Math.round(DURATION_BEATS[duration.base] * 1024), 4096);
  let dot = result;
  for (let index = 0; index < (duration.dots ?? 0); index++) {
    dot = fraction(dot.numerator, dot.denominator * 2);
    result = add(result, dot);
  }
  return result;
}

function durationXml(duration: Duration, path: string): string {
  const name = DURATION_NAMES[duration.base];
  if (!name) unsupported(`duration "${duration.base}" is not supported by MuseScore clipboard export`, path);
  const dots = duration.dots ? `<dots>${duration.dots}</dots>` : "";
  return `<durationType>${name}</durationType>${dots}`;
}

function tupletSpec(
  item: Extract<SequenceContent, { type: "tuplet" }>,
  path: string,
): { normal: number; actual: number; baseName: string; scale: Fraction } {
  const innerTotal = multiply(durationAsWhole(item.inner.duration), fraction(item.inner.multiple));
  const outerTotal = multiply(durationAsWhole(item.outer.duration), fraction(item.outer.multiple));
  const scale = multiply(outerTotal, fraction(innerTotal.denominator, innerTotal.numerator));
  const base = multiply(innerTotal, fraction(1, scale.denominator));
  const baseDuration = Object.entries(DURATION_NAMES).find(([durationBase]) =>
    isZero(subtract(durationAsWhole({ base: durationBase as Duration["base"] }), base)),
  );
  if (!baseDuration) {
    unsupported("tuplet ratio cannot be represented by a MuseScore baseNote", path);
  }
  return {
    normal: scale.numerator,
    actual: scale.denominator,
    baseName: baseDuration[1]!,
    scale,
  };
}

function markingsXml(markings: Markings | undefined, path: string): string {
  if (!markings) return "";
  const result: string[] = [];
  const supported = new Set(["staccato", "tenuto", "accent", "strongAccent", "staccatissimo", "spiccato", "trill"]);
  for (const key of Object.keys(markings)) {
    if (!supported.has(key)) unsupported(`marking "${key}" is not supported by MuseScore clipboard export`, path);
  }
  if (markings.staccato) result.push("<Articulation><subtype>articStaccatoAbove</subtype></Articulation>");
  if (markings.tenuto) result.push("<Articulation><subtype>articTenutoAbove</subtype></Articulation>");
  if (markings.accent) result.push("<Articulation><subtype>articAccentAbove</subtype></Articulation>");
  if (markings.strongAccent) result.push("<Articulation><subtype>articMarcatoAbove</subtype></Articulation>");
  if (markings.staccatissimo) result.push("<Articulation><subtype>articStaccatissimoAbove</subtype></Articulation>");
  if (markings.spiccato) result.push("<Articulation><subtype>articSpiccatoAbove</subtype></Articulation>");
  if (markings.trill) result.push("<Symbol><name>ornamentTrill</name></Symbol>");
  return result.join("");
}

function validateEvent(event: NoteEvent, path: string): void {
  if (event.lyrics) unsupported("lyrics are preserved in Viritura JSON but are not exported to StaffList yet", path);
  if (event.fermata) unsupported("fermatas are not exported to StaffList yet", path);
  if (event.kitNotes?.length) unsupported("percussion kit notes cannot be exported to StaffList yet", path);
  if (event.slurs?.length || event.glissandos?.length) {
    unsupported("slurs and glissandos cannot be exported to StaffList yet", path);
  }
}

function noteXml(event: NoteEvent, path: string): string {
  const notes = event.notes ?? [];
  if (notes.length === 0) return "";
  return notes
    .map((note, index) => {
      if (note.ties?.length) unsupported("ties cannot be exported to StaffList yet", `${path}/Note[${index}]`);
      const midi = midiFromPitch(note.pitch);
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
        throw new MuseScoreConversionError("invalid-pitch", "pitch is outside MIDI range", `${path}/Note[${index}]`);
      }
      return `<Note><pitch>${midi}</pitch><tpc>${tpcFromPitch(note.pitch)}</tpc></Note>`;
    })
    .join("");
}

function eventXml(event: NoteEvent, path: string): string {
  validateEvent(event, path);
  const markings = markingsXml(event.markings, path);
  if (event.rest || !event.notes?.length) {
    if (markings) unsupported("rest markings cannot be exported to StaffList yet", path);
    if (event.notes?.length) unsupported("an event containing both a rest and notes cannot be exported", path);
    return `<Rest>${durationXml(event.duration, path)}</Rest>`;
  }
  return `<Chord>${durationXml(event.duration, path)}${markings}${noteXml(event, path)}</Chord>`;
}

function moveXml(state: WriteState, staff: number, voice: number, time: Fraction): string {
  const staffDelta = staff - state.staff;
  const voiceDelta = voice - state.voice;
  const timeDelta = subtract(time, state.time);
  const fields = [
    staffDelta === 0 ? "" : `<staves>${staffDelta}</staves>`,
    voiceDelta === 0 ? "" : `<voices>${voiceDelta}</voices>`,
    isZero(timeDelta) ? "" : `<fractions>${formatFraction(timeDelta)}</fractions>`,
  ].join("");
  state.staff = staff;
  state.voice = voice;
  state.time = time;
  return fields ? `<location>${fields}</location>` : "";
}

function annotationOffset(captured: CapturedDynamic | CapturedChordSymbol, path: string): Fraction {
  if (captured.offset) return fromTuple(captured.offset);
  if (captured.measureOffset !== 0) {
    unsupported("annotation timing across mixed source measures is unavailable", path);
  }
  return fromTuple("dynamic" in captured ? captured.dynamic.position.fraction : captured.chordSymbol.position.fraction);
}

function dynamicXml(captured: CapturedDynamic, path: string): string {
  const dynamic = captured.dynamic;
  if (dynamic.type !== "immediate" || !dynamic.value) {
    unsupported(`dynamic type "${dynamic.type}" is not supported by MuseScore clipboard export`, path);
  }
  if (
    dynamic.playbackVelocity !== undefined &&
    (!Number.isInteger(dynamic.playbackVelocity) || dynamic.playbackVelocity < 1 || dynamic.playbackVelocity > 127)
  ) {
    throw new MuseScoreConversionError("invalid-structure", "dynamic velocity must be 1..127", path);
  }
  const velocity =
    dynamic.playbackVelocity === undefined ? "" : `<velocity>${Math.round(dynamic.playbackVelocity)}</velocity>`;
  return `<Dynamic><subtype>${escapeXml(dynamic.value)}</subtype>${velocity}</Dynamic>`;
}

function annotationTrack(
  tracks: readonly ExportTrack[],
  partOffset: number,
  sourceStaff: number | undefined,
  path: string,
  staffOffset?: number,
): ExportTrack {
  // Secondary-staff annotation interchange remains unsupported by the reader.
  if (sourceStaff !== undefined && sourceStaff !== 1) {
    unsupported(`annotations on source staff ${sourceStaff} cannot be mapped reliably to copied physical staves`, path);
  }
  const candidates = tracks.filter((candidate) => candidate.partOffset === partOffset);
  if (candidates.length === 0) unsupported("annotation's part has no copied track", path);
  const track =
    staffOffset === undefined
      ? (candidates.find((candidate) => candidate.sourceStaff === (sourceStaff ?? 1)) ??
        candidates.find((candidate) => candidate.sourceStaff === undefined))
      : candidates.find((candidate) => candidate.staff === staffOffset);
  if (!track) unsupported("annotation's staff has no copied track", path);
  return track;
}

function annotationsByTrack(
  selection: ClipboardSelection,
  tracks: readonly ExportTrack[],
): Map<ExportTrack, Annotation[]> {
  const result = new Map<ExportTrack, Annotation[]>();
  const append = (track: ExportTrack, annotation: Annotation): void => {
    const annotations = result.get(track) ?? [];
    annotations.push(annotation);
    result.set(track, annotations);
  };
  for (const [index, captured] of (selection.chordSymbols ?? []).entries()) {
    const path = `chordSymbols[${index}]`;
    const track = annotationTrack(
      tracks,
      captured.partOffset ?? 0,
      captured.chordSymbol.displayStaff,
      path,
      captured.staffOffset,
    );
    append(track, {
      offset: annotationOffset(captured, path),
      xml: serializeHarmony(captured.chordSymbol, path),
    });
  }

  const dynamicCaptures = new Map<string, string>();
  const appendDynamic = (captured: CapturedDynamic, sourcePartOffset: number, path: string): void => {
    const partOffset = captured.partOffset ?? sourcePartOffset;
    const track = annotationTrack(tracks, partOffset, captured.dynamic.staff, path, captured.staffOffset);
    const offset = annotationOffset(captured, path);
    const xml = dynamicXml(captured, path);
    // Capture can mirror a part-level dynamic on the selection and every voice.
    // Keep distinct parts and occurrences, but emit each captured occurrence once.
    const key = JSON.stringify([partOffset, captured.dynamic.id, formatFraction(offset)]);
    const previous = dynamicCaptures.get(key);
    if (previous !== undefined) {
      if (previous !== xml) unsupported("conflicting captures of the same dynamic", path);
      return;
    }
    dynamicCaptures.set(key, xml);
    append(track, { offset, xml });
  };
  for (const [index, captured] of (selection.dynamics ?? []).entries()) {
    appendDynamic(captured, 0, `dynamics[${index}]`);
  }
  for (const [trackIndex, track] of tracks.entries()) {
    for (const [index, captured] of (track.dynamics ?? []).entries()) {
      appendDynamic(captured, track.partOffset, `tracks[${trackIndex}]/dynamics[${index}]`);
    }
  }
  for (const annotations of result.values()) {
    annotations.sort((left, right) => compare(left.offset, right.offset));
  }
  return result;
}

function afterGraceTag(duration: Duration): string {
  if (duration.base === "16th") return "grace16after";
  if (duration.base === "32nd") return "grace32after";
  return "grace8after";
}

function writeContent(
  content: readonly SequenceContent[],
  scale: Fraction,
  state: WriteState,
  track: ExportTrack,
  path: string,
): string {
  const output: string[] = [];
  for (const [index, item] of content.entries()) {
    const itemPath = `${path}[${index}]`;
    switch (item.type) {
      case "event": {
        output.push(eventXml(item, itemPath));
        state.time = add(state.time, multiply(durationAsWhole(item.duration), scale));
        break;
      }
      case "space": {
        const target = add(state.time, multiply(fromTuple(item.duration), scale));
        output.push(moveXml(state, track.staff, track.voice, target));
        break;
      }
      case "grace":
        if (item.graceType === "makeTime") {
          unsupported("makeTime grace groups cannot be exported to StaffList", itemPath);
        }
        for (const [graceIndex, graceEvent] of item.content.entries()) {
          const gracePath = `${itemPath}/grace[${graceIndex}]`;
          validateEvent(graceEvent, gracePath);
          if (graceEvent.rest || !graceEvent.notes?.length) {
            unsupported("grace rests cannot be exported to StaffList", gracePath);
          }
          const graceTag =
            item.graceType === "stealPrevious"
              ? `<${afterGraceTag(graceEvent.duration)}/>`
              : item.slash
                ? "<acciaccatura/>"
                : "<appoggiatura/>";
          output.push(
            `<Chord>${durationXml(graceEvent.duration, gracePath)}${graceTag}${markingsXml(graceEvent.markings, gracePath)}${noteXml(graceEvent, gracePath)}</Chord>`,
          );
        }
        break;
      case "tuplet": {
        if (item.span) unsupported("cross-barline tuplets cannot be exported to StaffList", itemPath);
        const spec = tupletSpec(item, itemPath);
        output.push(
          `<Tuplet><normalNotes>${spec.normal}</normalNotes><actualNotes>${spec.actual}</actualNotes>` +
            `<baseNote>${spec.baseName}</baseNote></Tuplet>`,
        );
        const nestedScale = multiply(scale, spec.scale);
        output.push(writeContent(item.content, nestedScale, state, track, `${itemPath}/content`));
        output.push("<endTuplet/>");
        break;
      }

      case "tremolo":
        unsupported("multi-note tremolos cannot be exported to StaffList", itemPath);
    }
  }
  return output.join("");
}

function exportTracks(selection: ClipboardSelection): ExportTrack[] {
  const sourceTracks =
    selection.tracks && selection.tracks.length > 0
      ? selection.tracks
      : [{ partOffset: 0, voiceIndex: 0, staffOffset: 0, content: selection.events }];
  return sourceTracks
    .map((track) => {
      const staff = track.staffOffset ?? track.partOffset;
      const voice = track.voiceIndex;
      if (!Number.isInteger(staff) || staff < 0 || !Number.isInteger(voice) || voice < 0 || voice > 3) {
        unsupported("track cannot be mapped to MuseScore's four voices per physical staff", "tracks");
      }
      return { ...track, staff, voice };
    })
    .sort((left, right) => left.staff - right.staff || left.voice - right.voice);
}

function writeStaffList(selection: ClipboardSelection): string {
  if (selection.measureRepeats?.length)
    unsupported("measure repeats cannot be exported to StaffList", "measureRepeats");
  const tracks = exportTracks(selection);
  if (tracks.length === 0) unsupported("selection has no rhythmic content");
  const trackAnnotations = annotationsByTrack(selection, tracks);
  const staves = Math.max(...tracks.map((track) => track.staff)) + 1;
  const state: WriteState = { staff: 0, voice: 0, time: ZERO };
  const staffBodies = new Map<number, string[]>();
  let maximumEnd = ZERO;
  for (const track of tracks) {
    if (!staffBodies.has(track.staff)) {
      state.staff = track.staff;
      state.voice = 0;
    }
    const body = staffBodies.get(track.staff) ?? [];
    const leadIn = track.leadIn ? fromTuple(track.leadIn) : ZERO;
    body.push(moveXml(state, track.staff, track.voice, leadIn));
    const annotations = trackAnnotations.get(track) ?? [];
    body.push(writeContent(track.content, fraction(1), state, track, `tracks[${track.staff}:${track.voice}]`));
    if (compare(state.time, maximumEnd) > 0) maximumEnd = state.time;
    // An annotation's onset need not be a rhythmic boundary in its owning voice.
    // Write it outside tuplet/chord content with its own location movement.
    for (const annotation of annotations) {
      if (compare(annotation.offset, ZERO) < 0) {
        throw new MuseScoreConversionError("invalid-timing", "annotation occurs before the copied range");
      }
      body.push(moveXml(state, track.staff, track.voice, annotation.offset), annotation.xml);
    }
    if (compare(state.time, maximumEnd) > 0) maximumEnd = state.time;
    staffBodies.set(track.staff, body);
  }
  if (compare(maximumEnd, ZERO) <= 0) unsupported("selection has no timed rhythmic content");
  const staffXml = [...staffBodies.entries()]
    .sort(([left], [right]) => left - right)
    .map(([staff, body]) => {
      const offsets = tracks
        .filter((track) => track.staff === staff)
        .map((track) => {
          const ticks = Math.round(
            ((track.leadIn ? fromTuple(track.leadIn) : ZERO).numerator /
              (track.leadIn ? fromTuple(track.leadIn) : fraction(1)).denominator) *
              1920,
          );
          return `<voice id="${track.voice}">${ticks}</voice>`;
        })
        .join("");
      return `<Staff id="${staff}"><voiceOffset>${offsets}</voiceOffset>${body.join("")}</Staff>`;
    })
    .join("");
  return `<StaffList version="4.70" tick="0/1" len="${formatFraction(maximumEnd)}" staff="0" staves="${staves}">${staffXml}</StaffList>`;
}

export function writeMuseScoreStaffList(selection: ClipboardSelection): MuseScoreWriteResult {
  try {
    return { xml: writeStaffList(selection) };
  } catch (error) {
    if (error instanceof MuseScoreConversionError) return { xml: null, warning: error.userMessage() };
    return {
      xml: null,
      warning: "MuseScore clipboard: export failed; this selection can still be copied in Viritura format.",
    };
  }
}
