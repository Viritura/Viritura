import type { SequenceContent, NoteEvent, Pitch } from "@viritura/core";
import type { ClipboardFragment } from "../../clipboard/ClipboardFragment";

export interface FragmentMeta {
  timeSig: string;
  keySig: string;
  pitchRange: string | null;
}

interface PitchTuple {
  step: string;
  octave: number;
  alter: number;
}

export function describeFragment(fragment: ClipboardFragment): FragmentMeta {
  const ts = fragment.timeSignature;
  const timeSig = `${ts.count}/${ts.unit}`;
  const keySig = formatKeySignature(fragment.keySignature.fifths ?? 0);

  const pitches: PitchTuple[] = [];
  const visit = (events: SequenceContent[]) => {
    for (const ev of events) {
      if (ev.type !== "event") continue;
      const note = ev as NoteEvent;
      if (!note.notes) continue;
      for (const n of note.notes) {
        const p = n.pitch as Pitch | undefined;
        if (!p) continue;
        pitches.push({ step: p.step, octave: p.octave, alter: p.alter ?? 0 });
      }
    }
  };
  visit(fragment.content);
  for (const t of fragment.tracks ?? []) visit(t.content);

  let pitchRange: string | null = null;
  if (pitches.length > 0) {
    const sorted = [...pitches].sort((a, b) => pitchOrder(a) - pitchOrder(b));
    const lo = sorted[0]!;
    const hi = sorted[sorted.length - 1]!;
    pitchRange =
      lo === hi || pitchOrder(lo) === pitchOrder(hi) ? formatPitch(lo) : `${formatPitch(lo)}–${formatPitch(hi)}`;
  }

  return { timeSig, keySig, pitchRange };
}

function pitchOrder(p: PitchTuple): number {
  const stepOrder: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return p.octave * 12 + (stepOrder[p.step] ?? 0) + p.alter;
}

function formatPitch(p: PitchTuple): string {
  const acc = p.alter === 1 ? "♯" : p.alter === -1 ? "♭" : p.alter === 2 ? "𝄪" : p.alter === -2 ? "𝄫" : "";
  return `${p.step}${acc}${p.octave}`;
}

function formatKeySignature(fifths: number): string {
  if (fifths === 0) return "C maj";
  const sharps = ["C", "G", "D", "A", "E", "B", "F♯", "C♯"];
  const flats = ["C", "F", "B♭", "E♭", "A♭", "D♭", "G♭", "C♭"];
  if (fifths > 0 && fifths <= 7) return `${sharps[fifths]} maj`;
  if (fifths < 0 && fifths >= -7) return `${flats[-fifths]} maj`;
  return `${fifths > 0 ? "+" : ""}${fifths}`;
}
