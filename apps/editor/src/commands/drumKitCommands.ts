/**
 * Drum-kit mapping commands.
 *
 * Bridges the {@link DrumKitDialog} editable rows and the MNX score model:
 *  - {@link resolveDrumKitTarget} reads a percussion part's `kit` +
 *    `global.sounds` into editable rows.
 *  - {@link applyDrumKitEdits} writes the rows back: it updates each
 *    kit-component's staff position / notehead / borrowed-kit override and
 *    points it at a per-component `sound` entry carrying the chosen MIDI key.
 *  - {@link findPercussionPartIndex} locates the part to edit.
 */

import { produce } from "../score/scoreClone";
import { isPercussionPart } from "../score/kitInput";
import { keyLabel, defaultDrumKitProgram } from "@viritura/audio";
import type { Score, NoteheadShape, Part, SequenceContent, KitNote, KitComponent } from "@viritura/core";
import type { KitComponentEdit, DrumKitTarget } from "../components/DrumKitDialog";

/** Default GM key when a component has no resolvable sound (acoustic snare). */
const FALLBACK_MIDI_KEY = 38;

/**
 * Find the percussion part to edit: the `preferred` part when it's percussion,
 * else the first percussion part in the score. Returns null if none exist.
 */
export function findPercussionPartIndex(score: Score, preferred?: number): number | null {
  if (preferred !== undefined && isPercussionPart(score.parts[preferred])) return preferred;
  const idx = score.parts.findIndex((p) => isPercussionPart(p));
  return idx >= 0 ? idx : null;
}

/** Read a percussion part's kit into editable dialog rows. */
export function resolveDrumKitTarget(score: Score, partIndex: number): DrumKitTarget | null {
  const part = score.parts[partIndex];
  if (!part || !part.kit) return null;
  const sounds = score.global?.sounds;

  const components: KitComponentEdit[] = Object.entries(part.kit).map(([id, comp]) => {
    const soundId = comp.sound;
    const midi = soundId ? sounds?.[soundId]?.midiNumber : undefined;
    return {
      id,
      name: comp.name ?? id,
      staffPosition: comp.staffPosition ?? 0,
      notehead: comp.notehead ?? "normal",
      drumKit: comp.drumKit,
      midiKey: typeof midi === "number" ? midi : FALLBACK_MIDI_KEY,
    };
  });
  // Stable ordering: top of staff first (highest staffPosition).
  components.sort((a, b) => b.staffPosition - a.staffPosition);

  return { partIndex, partName: part.name, components };
}

/**
 * Apply edited mapping rows to the score. The part's `kit` is rebuilt entirely
 * from `edits` so the visual editor and presets can add or remove components.
 * Each component gets a dedicated, part-scoped `snd-p<idx>-<id>` sound entry
 * carrying its MIDI key; sound entries no longer referenced by any kit
 * component (in any part) are pruned.
 *
 * When a component is *removed* (directly, or wholesale by a preset replace
 * whose ids never match the existing ones), any notes that referenced it would
 * otherwise dangle — the engine renders a dangling kit-note on the middle line
 * with a normal notehead. To avoid that, removed components' notes are remapped
 * to the surviving component nearest in staff position, so a preset replace
 * re-skins the kit in place instead of orphaning every note.
 */
export function applyDrumKitEdits(score: Score, partIndex: number, edits: readonly KitComponentEdit[]): Score {
  if (edits.length === 0) return score;
  return produce(score, (draft) => {
    const part = draft.parts[partIndex];
    if (!part || !draft.global) return;
    const sounds = (draft.global.sounds ??= {});

    // Snapshot the pre-edit kit so we can rebind notes whose component is gone.
    const oldKit = part.kit ?? {};

    const newKit: NonNullable<typeof part.kit> = {};
    for (const edit of edits) {
      const soundId = `snd-p${partIndex}-${edit.id}`;
      const comp: (typeof newKit)[string] = { staffPosition: edit.staffPosition, name: edit.name, sound: soundId };
      if (edit.notehead !== "normal") comp.notehead = edit.notehead as NoteheadShape;
      if (edit.drumKit !== undefined) comp.drumKit = edit.drumKit;
      newKit[edit.id] = comp;

      const program = edit.drumKit ?? defaultDrumKitProgram();
      sounds[soundId] = { midiNumber: edit.midiKey, name: keyLabel(program, edit.midiKey) };
    }

    // Rewrite kit-note references for removed components before swapping kits.
    const remap = buildRemovedComponentRemap(oldKit, newKit);
    remapKitNoteRefs(part, remap);

    part.kit = newKit;

    // Prune `snd-`-prefixed sounds no longer referenced by any kit component.
    const referenced = new Set<string>();
    for (const p of draft.parts) {
      for (const c of Object.values(p.kit ?? {})) {
        if (c.sound) referenced.add(c.sound);
      }
    }
    for (const id of Object.keys(sounds)) {
      if (id.startsWith("snd-") && !referenced.has(id)) delete sounds[id];
    }
  });
}

/** Build an old→new kit-component ID remap for components the edit removed.
 *  A removed component's notes rebind to the surviving component nearest in
 *  staff position (deterministic id tie-break). Ids that survive (in-place
 *  edits, reorders) are absent from the map, so their notes are left untouched.
 *  Empty when nothing was removed or no survivors remain (degenerate empty kit). */
function buildRemovedComponentRemap(
  oldKit: Record<string, { staffPosition?: number }>,
  newKit: Record<string, { staffPosition: number }>,
): Map<string, string> {
  const remap = new Map<string, string>();
  const survivors = Object.entries(newKit).map(([id, c]) => ({ id, pos: c.staffPosition }));
  if (survivors.length === 0) return remap;
  for (const [oldId, oldComp] of Object.entries(oldKit)) {
    if (newKit[oldId]) continue; // id preserved → engine reads the updated component
    const oldPos = oldComp.staffPosition ?? 0;
    let best = survivors[0]!;
    let bestDist = Math.abs(best.pos - oldPos);
    for (const s of survivors) {
      const d = Math.abs(s.pos - oldPos);
      if (d < bestDist || (d === bestDist && s.id < best.id)) {
        best = s;
        bestDist = d;
      }
    }
    remap.set(oldId, best.id);
  }
  return remap;
}

/** Walk a part's events (recursing tuplet / grace / tremolo) and rewrite each
 *  kit-note's `kitComponent` through `remap`. No-op when `remap` is empty. */
function remapKitNoteRefs(part: Part, remap: Map<string, string>): void {
  if (remap.size === 0) return;
  const visit = (items: SequenceContent[]): void => {
    for (const item of items) {
      if (item.type === "event") {
        for (const kn of item.kitNotes ?? []) {
          const next = remap.get(kn.kitComponent);
          if (next !== undefined) kn.kitComponent = next;
        }
      } else if (item.type === "tuplet" || item.type === "grace" || item.type === "tremolo") {
        visit(item.content);
      }
    }
  };
  for (const measure of part.measures) {
    for (const seq of measure.sequences ?? []) visit(seq.content);
  }
}

/** Location of an event whose notehead is being changed. */
export interface SetNoteheadParams {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  /** Index of the container (tuplet / grace / tremolo) in `seq.content`, if any. */
  tupletIndex?: number;
  notehead: NoteheadShape;
}

/**
 * Set the notehead shape of every note in the targeted event.
 *
 * Pitched events: stored on each `note._x.viritura.notehead` (Option A — the
 * engine ignores this for now, but it round-trips through MNX). Setting
 * `"normal"` clears the override.
 *
 * Percussion events: notehead is a property of the *kit-component*, not the
 * kit-note, so we translate — for each kit-note we find (or create) a component
 * with the same sound / staff position / borrowed kit but the requested
 * notehead, then repoint the kit-note at it. This keeps notehead bound to the
 * instrument and renders today without any engine change.
 *
 * Returns the same reference (no-op) when nothing changes.
 */
export function setEventNotehead(score: Score, params: SetNoteheadParams): Score | null {
  const { partIndex, measureIndex, sequenceIndex, eventIndex, tupletIndex, notehead } = params;
  return produce(score, (draft) => {
    const part = draft.parts[partIndex];
    const seq = part?.measures[measureIndex]?.sequences[sequenceIndex];
    if (!part || !seq) return;
    const content = resolveEventContainer(seq.content, tupletIndex);
    const event = content?.[eventIndex];
    if (!event || event.type !== "event") return;

    if (event.notes && event.notes.length > 0) {
      for (const note of event.notes) {
        if (notehead === "normal") delete note.notehead;
        else note.notehead = notehead;
      }
      return;
    }
    if (event.kitNotes && event.kitNotes.length > 0) {
      for (const kn of event.kitNotes) applyNoteheadToKitNote(part, kn, notehead);
    }
  });
}

/** Resolve the content array an event lives in, descending into a container
 *  (tuplet / grace / tremolo) when `tupletIndex` is set. */
function resolveEventContainer(content: SequenceContent[], tupletIndex: number | undefined): SequenceContent[] | null {
  if (tupletIndex === undefined) return content;
  const container = content[tupletIndex];
  if (container && (container.type === "tuplet" || container.type === "grace" || container.type === "tremolo")) {
    return container.content;
  }
  return null;
}

/** Point a kit-note at a kit-component carrying `notehead`, reusing an existing
 *  matching component or minting a new one (same sound / staff position /
 *  borrowed kit). No-op when the current component already has that notehead. */
function applyNoteheadToKitNote(part: Part, kitNote: KitNote, notehead: NoteheadShape): void {
  const kit = part.kit;
  if (!kit) return;
  const current = kit[kitNote.kitComponent];
  if (!current) return;
  if ((current.notehead ?? "normal") === notehead) return;

  // Reuse a sibling component that already represents this instrument with the
  // requested notehead, so toggling between noteheads doesn't bloat the kit.
  for (const [id, comp] of Object.entries(kit)) {
    if (id === kitNote.kitComponent) continue;
    if (
      (comp.staffPosition ?? 0) === (current.staffPosition ?? 0) &&
      comp.sound === current.sound &&
      comp.drumKit === current.drumKit &&
      (comp.notehead ?? "normal") === notehead
    ) {
      kitNote.kitComponent = id;
      return;
    }
  }

  // Mint a new component cloned from the current one with the chosen notehead.
  const newComp: KitComponent = { ...current };
  if (notehead === "normal") delete newComp.notehead;
  else newComp.notehead = notehead;
  const newId = freshKitComponentId(kit, kitNote.kitComponent, notehead);
  kit[newId] = newComp;
  kitNote.kitComponent = newId;
}

/** Generate a kit-component id not already present in `kit`, derived from the
 *  source id and target notehead for readability. */
function freshKitComponentId(kit: Record<string, KitComponent>, baseId: string, notehead: NoteheadShape): string {
  const candidate = `${baseId}-${notehead}`;
  if (!kit[candidate]) return candidate;
  let n = 2;
  while (kit[`${candidate}-${n}`]) n++;
  return `${candidate}-${n}`;
}

/** Read the current notehead of the targeted event for inspector display.
 *  Pitched events report `note[0]`'s override; percussion events report the
 *  kit-component their first kit-note points at. Defaults to `"normal"`. */
export function getEventNotehead(
  score: Score,
  loc: { partIndex: number; measureIndex: number; sequenceIndex: number; eventIndex: number; tupletIndex?: number },
): NoteheadShape | null {
  const part = score.parts[loc.partIndex];
  const seq = part?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
  if (!part || !seq) return null;
  const content = resolveEventContainer(seq.content, loc.tupletIndex);
  const event = content?.[loc.eventIndex];
  if (!event || event.type !== "event") return null;
  if (event.notes && event.notes.length > 0) return event.notes[0]?.notehead ?? "normal";
  if (event.kitNotes && event.kitNotes.length > 0) {
    const compId = event.kitNotes[0]?.kitComponent;
    if (compId) return part.kit?.[compId]?.notehead ?? "normal";
  }
  return null;
}
