import { generateId, type SequenceContent, type NoteEvent } from "@viritura/core";
import { VIRITURA_FRAGMENT_TYPE, FRAGMENT_VERSION, type ClipboardFragment } from "./ClipboardFragment";

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
  // Versions 1 and 2 are both supported
  if (typeof obj["version"] !== "number" || obj["version"] < 1) return false;

  if (!isTimeSignature(obj["timeSignature"])) return false;
  if (!isKeySignature(obj["keySignature"])) return false;
  if (!Array.isArray(obj["content"])) return false;

  // Validate each content item is a valid SequenceContent
  for (const item of obj["content"] as unknown[]) {
    if (!isSequenceContent(item)) return false;
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
    // Visual space — must have a duration
    return isDuration(obj["duration"]);
  }
  return false;
}

function isDuration(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj["base"] === "string";
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
  // First pass: clone the whole tree and assign new IDs to every NoteEvent,
  // collecting old→new mappings for slur/tie remapping in pass 2.
  const eventIdMap = new Map<string, string>();
  const noteIdMap = new Map<string, string>();

  /** Mutates a cloned NoteEvent in place: assigns new id and note ids. */
  function freshenEvent(ev: NoteEvent): void {
    const newEventId = generateId();
    if (ev.id) eventIdMap.set(ev.id, newEventId);
    ev.id = newEventId;
    if (ev.notes) {
      for (const note of ev.notes) {
        const newNoteId = generateId();
        if (note.id) noteIdMap.set(note.id, newNoteId);
        note.id = newNoteId;
      }
    }
  }

  /** Recursively walk any SequenceContent and freshen all NoteEvents. */
  function freshenItem(item: SequenceContent): SequenceContent {
    const clone = structuredClone(item);
    switch (clone.type) {
      case "event":
        freshenEvent(clone as NoteEvent);
        break;
      case "grace": {
        const g = clone as import("@viritura/core").Grace;
        for (const ev of g.content) freshenEvent(ev);
        break;
      }
      case "tuplet": {
        const t = clone as import("@viritura/core").Tuplet;
        t.content = t.content.map((inner) => freshenItem(inner));
        break;
      }
      case "tremolo": {
        const tr = clone as import("@viritura/core").MultiNoteTremolo;
        for (const ev of tr.content) freshenEvent(ev);
        break;
      }
      // "space" has no events — nothing to freshen
    }
    return clone;
  }

  const clones = content.map(freshenItem);

  // Second pass: remap slur and tie targets throughout the whole tree.
  // Slurs from grace events to main events (or vice versa) are also covered.
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
    if (ev.notes) {
      for (const note of ev.notes) {
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
  }

  function remapItem(item: SequenceContent): void {
    switch (item.type) {
      case "event":
        remapEvent(item as NoteEvent);
        break;
      case "grace": {
        const g = item as import("@viritura/core").Grace;
        for (const ev of g.content) remapEvent(ev);
        break;
      }
      case "tuplet": {
        const t = item as import("@viritura/core").Tuplet;
        for (const inner of t.content) remapItem(inner);
        break;
      }
      case "tremolo": {
        const tr = item as import("@viritura/core").MultiNoteTremolo;
        for (const ev of tr.content) remapEvent(ev);
        break;
      }
    }
  }

  for (const clone of clones) remapItem(clone);

  return clones;
}
