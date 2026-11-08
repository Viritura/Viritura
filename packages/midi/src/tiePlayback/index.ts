import { pitchToMidi, type Note, type Part, type SequenceContent, type Tie } from "@viritura/core";
import { durationBeats } from "../timeline";

export type TiePlaybackTargets = Map<string, readonly Tie[]>;

export function tiePlaybackKey(pitch: number, partIndex: number, voice: string): string {
  return `${pitch}:${partIndex}:${voice}`;
}

export function recordTieTargets(state: TiePlaybackTargets, key: string, note: Note): void {
  const targets = note.ties?.filter((tie) => tie.lv !== true && tie.target !== undefined) ?? [];
  if (targets.length) state.set(key, targets);
  else state.delete(key);
}

export function tieContinuesTo(state: TiePlaybackTargets, key: string, note: Note): boolean {
  return note.id !== undefined && (state.get(key)?.some((tie) => tie.target === note.id) ?? false);
}

function notesAtBeat(
  content: readonly SequenceContent[],
  target: number,
  notes: Note[],
  offset = 0,
  ratio = 1,
): number {
  let beat = offset;
  for (const item of content) {
    if (item.type === "event") {
      if (Math.abs(beat - target) < 1e-9) notes.push(...(item.notes ?? []));
      beat += durationBeats(item.duration) * ratio;
    } else if (item.type === "tuplet") {
      const factor =
        (durationBeats(item.outer.duration) * item.outer.multiple) /
        (durationBeats(item.inner.duration) * item.inner.multiple);
      beat = notesAtBeat(item.content, target, notes, beat, ratio * factor);
    } else if (item.type === "space") {
      beat += (item.duration[0] / item.duration[1]) * 4 * ratio;
    } else if (item.type === "tremolo") {
      if (Math.abs(beat - target) < 1e-9) notes.push(...(item.content[0]?.notes ?? []));
      beat += durationBeats(item.outer.duration) * item.outer.multiple * ratio;
    }
    if (beat > target + 1e-9) break;
  }
  return beat;
}

/** Only explicit crossJump targets at the actual route-entry beat can keep a held note across a discontinuity. */
export function crossJumpContinuationKeys(
  state: TiePlaybackTargets,
  measure: Part["measures"][number] | undefined,
  startBeat: number,
  partIndex: number,
  ratioForStaff: (staff: number) => number,
): Set<string> {
  const keys = new Set<string>();
  for (const [index, sequence] of (measure?.sequences ?? []).entries()) {
    const notes: Note[] = [];
    notesAtBeat(sequence.content, startBeat / ratioForStaff(sequence.staff ?? 1), notes);
    for (const note of notes) {
      const key = tiePlaybackKey(pitchToMidi(note.pitch), partIndex, sequence.voice ?? `v${index}`);
      if (
        note.id !== undefined &&
        state.get(key)?.some((tie) => tie.targetType === "crossJump" && tie.target === note.id)
      )
        keys.add(key);
    }
  }
  return keys;
}
