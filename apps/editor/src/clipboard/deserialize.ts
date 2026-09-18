import { generateId, walkSequenceEvents, type SequenceContent, type NoteEvent } from "@viritura/core";
import {
  VIRITURA_FRAGMENT_TYPE,
  FRAGMENT_VERSION,
  type ClipboardFragment,
  type ClipboardTrack,
} from "./ClipboardFragment";

/**
 * Attempt to deserialize a clipboard text string into a ClipboardFragment.
 * Returns null if the text is not a valid Viritura fragment.
 */
export function deserializeFragment(text: string): ClipboardFragment | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isClipboardFragment(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Type guard: checks that the parsed JSON matches the ClipboardFragment shape.
 */
function isClipboardFragment(value: unknown): value is ClipboardFragment {
  if (typeof value !== "object" || value === null) return false;

  const obj = value as Record<string, unknown>;

  if (obj["type"] !== VIRITURA_FRAGMENT_TYPE) return false;
  if ((obj["version"] as number) > FRAGMENT_VERSION) return false;
  // Older fragment versions remain supported.
  if (typeof obj["version"] !== "number" || obj["version"] < 1) return false;

  if (!isTimeSignature(obj["timeSignature"])) return false;
  if (!isKeySignature(obj["keySignature"])) return false;
  if (!Array.isArray(obj["content"])) return false;
  if (obj["lyrics"] !== undefined && !isGlobalLyrics(obj["lyrics"])) return false;

  // Validate each content item is a valid SequenceContent
  for (const item of obj["content"] as unknown[]) {
    if (!isSequenceContent(item)) return false;
  }

  return true;
}

function isGlobalLyrics(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const lyrics = value as Record<string, unknown>;
  if (lyrics["lineOrder"] !== undefined) {
    if (!Array.isArray(lyrics["lineOrder"]) || !lyrics["lineOrder"].every((lineId) => typeof lineId === "string")) {
      return false;
    }
  }
  if (lyrics["lineMetadata"] === undefined) return true;
  if (
    typeof lyrics["lineMetadata"] !== "object" ||
    lyrics["lineMetadata"] === null ||
    Array.isArray(lyrics["lineMetadata"])
  ) {
    return false;
  }
  for (const metadata of Object.values(lyrics["lineMetadata"] as Record<string, unknown>)) {
    if (typeof metadata !== "object" || metadata === null) return false;
    const entry = metadata as Record<string, unknown>;
    if (entry["label"] !== undefined && typeof entry["label"] !== "string") return false;
    if (entry["lang"] !== undefined && typeof entry["lang"] !== "string") return false;
  }
  return true;
}

function isTimeSignature(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj["count"] === "number" && typeof obj["unit"] === "number";
}

function isKeySignature(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj["fifths"] === "number";
}

function isSequenceContent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  const type = obj["type"];

  if (type === "event") {
    // NoteEvent — must have a duration
    return isDuration(obj["duration"]);
  }
  if (type === "grace") {
    // Grace container — must have a content array of events
    return Array.isArray(obj["content"]);
  }
  if (type === "tuplet") {
    // Tuplet container — must have inner/outer durations and a content array
    return Array.isArray(obj["content"]);
  }
  if (type === "tremolo") {
    // Multi-note tremolo container — must have a content array
    return Array.isArray(obj["content"]);
  }
  if (type === "space") {
    return isSpaceDuration(obj["duration"]);
  }
  return false;
}

function isDuration(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj["base"] === "string";
}

function isSpaceDuration(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    value[0] >= 0 &&
    Number.isInteger(value[1]) &&
    value[1] > 0
  );
}

/**
 * Assign fresh IDs to all events and notes in a fragment's content,
 * and remap slur/tie target references to the new IDs.
 * Returns a new array (does not mutate the input).
 *
 * Handles nested containers: Grace, Tuplet, and MultiNoteTremolo all carry
 * inner NoteEvents that need fresh IDs so multi-paste doesn't produce
 * duplicate IDs in the score.
 */
export function assignFreshIds(content: SequenceContent[]): SequenceContent[] {
  const clone = structuredClone(content);
  freshenEvents([...walkSequenceEvents(clone)].map(({ event }) => event));
  return clone;
}

/**
 * Freshen the authoritative tracks together so internal connectors can cross
 * tracks. The returned content aliases the fresh primary track, not a second
 * independently freshened copy. Without tracks, preserve the flat API behavior.
 */
export function assignFreshTrackIds(
  content: SequenceContent[],
  tracks?: ClipboardTrack[],
): { content: SequenceContent[]; tracks?: ClipboardTrack[] } {
  if (!tracks?.length) {
    return { content: assignFreshIds(content), ...(tracks ? { tracks: [] } : {}) };
  }

  const primaryIndex = findPrimaryTrackIndex(content, tracks);
  const clones = structuredClone(tracks);
  freshenEvents(clones.flatMap((track) => [...walkSequenceEvents(track.content)].map(({ event }) => event)));
  return { content: clones[primaryIndex]!.content, tracks: clones };
}

function findPrimaryTrackIndex(content: SequenceContent[], tracks: ClipboardTrack[]): number {
  const referenceIndex = tracks.findIndex((track) => track.content === content);
  if (referenceIndex >= 0) return referenceIndex;

  // Serialization clones primary content separately. Legacy measure selections
  // can also aggregate several tracks; their first identifiable event anchors
  // the primary rather than the track's position in the array.
  const trackEventIds = tracks.map(
    (track) => new Set([...walkSequenceEvents(track.content)].map(({ event }) => event.id).filter(Boolean)),
  );
  for (const { event } of walkSequenceEvents(content)) {
    if (!event.id) continue;
    const eventIndex = trackEventIds.findIndex((ids) => ids.has(event.id));
    if (eventIndex >= 0) return eventIndex;
  }

  const serializedContent = JSON.stringify(content);
  const contentIndex = tracks.findIndex((track) => JSON.stringify(track.content) === serializedContent);
  // Tracks take precedence when old payloads have no matching primary content.
  return contentIndex >= 0 ? contentIndex : 0;
}

function freshenEvents(events: NoteEvent[]): void {
  // Assign every ID before remapping any connector, including forward references.
  const eventIdMap = new Map<string, string>();
  const noteIdMap = new Map<string, string>();

  for (const ev of events) {
    const newEventId = generateId();
    if (ev.id) eventIdMap.set(ev.id, newEventId);
    ev.id = newEventId;
    for (const note of [...(ev.notes ?? []), ...(ev.kitNotes ?? [])]) {
      const newNoteId = generateId();
      if (note.id) noteIdMap.set(note.id, newNoteId);
      note.id = newNoteId;
    }
  }

  function remapEvent(ev: NoteEvent): void {
    if (ev.slurs) {
      ev.slurs = ev.slurs.filter((slur: { target: string; startNote?: string; endNote?: string }) => {
        const mapped = eventIdMap.get(slur.target);
        if (!mapped) return false; // target not in fragment — drop the slur
        slur.target = mapped;
        if (slur.startNote) {
          const mappedNote = noteIdMap.get(slur.startNote);
          if (mappedNote) slur.startNote = mappedNote;
          else delete slur.startNote;
        }
        if (slur.endNote) {
          const mappedNote = noteIdMap.get(slur.endNote);
          if (mappedNote) slur.endNote = mappedNote;
          else delete slur.endNote;
        }
        return true;
      });
      if (ev.slurs.length === 0) delete ev.slurs;
    }
    for (const note of [...(ev.notes ?? []), ...(ev.kitNotes ?? [])]) {
      if (note.ties) {
        note.ties = note.ties.filter((tie: { target?: string }) => {
          if (!tie.target) return true; // lv ties have no target
          const mappedNote = noteIdMap.get(tie.target);
          if (!mappedNote) return false; // target not in fragment — drop
          tie.target = mappedNote;
          return true;
        });
        if (note.ties.length === 0) delete note.ties;
      }
    }
  }

  for (const event of events) remapEvent(event);
}
