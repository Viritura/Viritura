import { DURATION_BEATS, type Duration, type Note, type SequenceContent, type Tie } from "@viritura/core";
import { MuseScoreConversionError, unsupported } from "./errors";
import { ZERO, add, compare, fraction, fromTuple, multiply, type Fraction } from "./fractions";
import { midiFromPitch } from "./pitch";
import { noteConnectorOrdinals } from "./noteConnectorOrder";
import { connectorLocationKey, connectorPairXml, type ConnectorLocation } from "./relativeConnectors";

export interface TieExportTrack {
  staff: number;
  voice: number;
  partOffset: number;
  content: SequenceContent[];
  leadIn?: [number, number];
}

interface IndexedNote {
  note: Note;
  location: ConnectorLocation;
  grace: boolean;
  ambiguousChord: boolean;
  path: string;
}

interface NoteIndex {
  notes: IndexedNote[];
  byId: Map<string, IndexedNote[]>;
  byLocation: Map<string, IndexedNote[]>;
}

interface TieSpec {
  target: string;
  properties: string;
}

export function orderedMuseScoreNotes(notes: readonly Note[]): Note[] {
  return notes
    .map((note) => {
      const pitch = note?.pitch ? midiFromPitch(note.pitch) : Number.NaN;
      if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
        throw new MuseScoreConversionError("invalid-pitch", "note pitch is outside MIDI range");
      }
      return { note, pitch };
    })
    .sort((left, right) => left.pitch - right.pitch)
    .map(({ note }) => note);
}

function durationAsWhole(duration: Duration, path: string): Fraction {
  const dots = duration?.dots ?? 0;
  if (!duration || !Number.isSafeInteger(dots) || dots < 0) {
    throw new MuseScoreConversionError("invalid-timing", "invalid note duration", path);
  }
  let result = fraction(DURATION_BEATS[duration.base] * 1024, 4096, path);
  let dot = result;
  for (let index = 0; index < dots; index++) {
    dot = fraction(dot.numerator, dot.denominator * 2, path);
    result = add(result, dot);
  }
  return result;
}

function nonnegative(value: Fraction, path: string): Fraction {
  if (compare(value, ZERO) < 0) {
    throw new MuseScoreConversionError("invalid-timing", "tie location cannot have negative timing", path);
  }
  return value;
}

function indexNote(index: NoteIndex, entry: IndexedNote): void {
  index.notes.push(entry);
  const id = entry.note.id;
  if (id !== undefined) {
    if (typeof id !== "string" || id.trim() === "") {
      throw new MuseScoreConversionError("invalid-structure", "invalid note ID", entry.path);
    }
    const matches = index.byId.get(id) ?? [];
    matches.push(entry);
    index.byId.set(id, matches);
  }
  // Grace chords share their anchor's time but need a separate connector coordinate.
  if (!entry.grace) {
    const key = connectorLocationKey(entry.location);
    const matches = index.byLocation.get(key) ?? [];
    matches.push(entry);
    index.byLocation.set(key, matches);
  }
}

function tupletScale(item: Extract<SequenceContent, { type: "tuplet" }>, path: string): Fraction {
  const inner = multiply(durationAsWhole(item.inner.duration, path), fraction(item.inner.multiple));
  const outer = multiply(durationAsWhole(item.outer.duration, path), fraction(item.outer.multiple));
  if (compare(inner, ZERO) <= 0 || compare(outer, ZERO) <= 0) {
    throw new MuseScoreConversionError("invalid-timing", "tuplet totals must be positive", path);
  }
  return multiply(outer, fraction(inner.denominator, inner.numerator));
}

function indexContent(
  content: readonly SequenceContent[],
  track: TieExportTrack,
  index: NoteIndex,
  onset: Fraction,
  scale: Fraction,
  path: string,
  grace = false,
): Fraction {
  let time = onset;
  for (const [contentIndex, item] of content.entries()) {
    const itemPath = `${path}[${contentIndex}]`;
    switch (item.type) {
      case "event": {
        if (item.rest && item.notes?.length) {
          unsupported("an event containing both a rest and notes cannot be exported", itemPath);
        }
        const notes = orderedMuseScoreNotes(item.notes ?? []);
        const sourceOrdinals = noteConnectorOrdinals(notes);
        // MuseScore can reorder equal concert pitches before resolving ties.
        // Keep source XML ordinals for import, but reject ambiguous export endpoints.
        const ambiguousChord = new Set(notes.map((note) => midiFromPitch(note.pitch))).size !== notes.length;
        for (const [xmlIndex, note] of notes.entries()) {
          const ordinal = sourceOrdinals[xmlIndex]!;
          indexNote(index, {
            note,
            location: { staff: track.staff, voice: track.voice, time, note: ordinal },
            grace,
            ambiguousChord,
            path: `${itemPath}/Note[${ordinal}]`,
          });
        }
        if (!grace) time = add(time, multiply(durationAsWhole(item.duration, itemPath), scale));
        break;
      }
      case "space":
        time = add(time, multiply(nonnegative(fromTuple(item.duration), itemPath), scale));
        break;
      case "tuplet":
        time = indexContent(
          item.content,
          track,
          index,
          time,
          multiply(scale, tupletScale(item, itemPath)),
          `${itemPath}/content`,
          grace,
        );
        break;
      case "grace":
        if (item.graceType === "makeTime") {
          unsupported("makeTime grace groups cannot be exported to StaffList", itemPath);
        }
        indexContent(item.content, track, index, time, scale, `${itemPath}/grace`, true);
        break;
      case "tremolo":
        unsupported("multi-note tremolos cannot be exported to StaffList", itemPath);
    }
  }
  return time;
}

function buildNoteIndex(tracks: readonly TieExportTrack[]): NoteIndex {
  const index: NoteIndex = { notes: [], byId: new Map(), byLocation: new Map() };
  for (const [trackIndex, track] of tracks.entries()) {
    const path = `tracks[${trackIndex}]`;
    if (
      !Number.isSafeInteger(track.staff) ||
      track.staff < 0 ||
      !Number.isInteger(track.voice) ||
      track.voice < 0 ||
      track.voice > 3
    ) {
      unsupported("tie track must have a valid staff and a voice from 0 to 3", path);
    }
    const onset = nonnegative(track.leadIn ? fromTuple(track.leadIn) : ZERO, path);
    indexContent(track.content, track, index, onset, fraction(1), `${path}/content`);
  }
  for (const [id, matches] of index.byId) {
    if (matches.length > 1) {
      throw new MuseScoreConversionError(
        "invalid-structure",
        `duplicate note ID "${id}" is ambiguous`,
        matches[0]!.path,
      );
    }
  }
  return index;
}

function tieSpec(tie: Tie, path: string): TieSpec {
  if (!tie || typeof tie !== "object" || Array.isArray(tie)) {
    throw new MuseScoreConversionError("invalid-structure", "invalid tie", path);
  }
  for (const key of Object.keys(tie)) {
    if (!["target", "targetType", "side", "lv", "id", "_c"].includes(key)) {
      unsupported(`tie property "${key}" cannot be exported to StaffList`, path);
    }
  }
  if (tie.lv !== undefined && tie.lv !== false) {
    unsupported("laissez-vibrer ties cannot be exported to StaffList", path);
  }
  if (tie.targetType !== undefined && tie.targetType !== "nextNote" && tie.targetType !== "crossVoice") {
    unsupported(`tie target type "${tie.targetType}" cannot be exported to StaffList`, path);
  }
  if (typeof tie.target !== "string" || tie.target.trim() === "") {
    unsupported("tie is missing an explicit target note ID", path);
  }
  if (tie.side !== undefined && tie.side !== "up" && tie.side !== "down") {
    unsupported(`tie side "${tie.side}" cannot be exported to StaffList`, path);
  }
  // MuseScore 4.70 serializes SLUR_DIRECTION as the "up" property (up/down/auto).
  return { target: tie.target, properties: tie.side ? `<up>${tie.side}</up>` : "" };
}

function validateEndpoints(index: NoteIndex, start: IndexedNote, end: IndexedNote, path: string): void {
  if (start.grace || end.grace) {
    unsupported("ties involving grace notes cannot be exported to StaffList", path);
  }
  for (const endpoint of [start, end]) {
    const chordStart = { ...endpoint.location, note: 0 };
    if (index.byLocation.get(connectorLocationKey(chordStart))?.length !== 1) {
      throw new MuseScoreConversionError("invalid-structure", "tie endpoint location is ambiguous", endpoint.path);
    }
  }
  if (compare(end.location.time, start.location.time) <= 0) {
    throw new MuseScoreConversionError("invalid-timing", "tie target must be strictly later than its source", path);
  }
  if (midiFromPitch(start.note.pitch) !== midiFromPitch(end.note.pitch)) {
    throw new MuseScoreConversionError("invalid-pitch", "tie endpoints must have the same MIDI pitch", path);
  }
  if (start.ambiguousChord || end.ambiguousChord) {
    unsupported(
      "unison-chord ties (including enharmonic unisons) cannot be exported to MuseScore because chord reordering can change tie targets",
      path,
    );
  }
}

export function buildTieConnectors(tracks: readonly TieExportTrack[]): Map<Note, string> {
  const index = buildNoteIndex(tracks);
  const starts = new Map<Note, string>();
  const ends = new Map<Note, string>();
  for (const start of index.notes) {
    const ties = start.note.ties;
    if (ties === undefined) continue;
    if (!Array.isArray(ties)) {
      throw new MuseScoreConversionError("invalid-structure", "invalid tie list", start.path);
    }
    if (ties.length === 0) continue;
    if (start.grace) unsupported("ties involving grace notes cannot be exported to StaffList", start.path);
    if (ties.length > 1 || starts.has(start.note)) {
      unsupported("multiple outgoing ties on one note cannot be exported to StaffList", start.path);
    }
    const path = `${start.path}/ties[0]`;
    const spec = tieSpec(ties[0]!, path);
    const targets = index.byId.get(spec.target);
    if (!targets?.length) {
      unsupported(`tie target "${spec.target}" is outside the copied selection or is not a note`, path);
    }
    const end = targets[0]!;
    validateEndpoints(index, start, end, path);
    if (ends.has(end.note)) {
      unsupported("multiple incoming ties on one note cannot be exported to StaffList", path);
    }
    const xml = connectorPairXml("Tie", start.location, end.location, spec.properties);
    starts.set(start.note, xml.start);
    ends.set(end.note, xml.end);
  }
  const result = new Map<Note, string>();
  for (const { note } of index.notes) {
    const xml = (starts.get(note) ?? "") + (ends.get(note) ?? "");
    if (xml) result.set(note, xml);
  }
  return result;
}
