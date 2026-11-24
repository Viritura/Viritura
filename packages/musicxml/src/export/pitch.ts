import { STEP_SEMITONES, type Interval, type Note, type Transposition } from "@viritura/core";
import { node, type XmlContext, type XmlElement } from "./xml";

const STEPS = "CDEFGAB";
const NATURALS = [...STEPS].map((step) => STEP_SEMITONES[step]!);

export function writtenPitch(note: Note, interval?: Interval): { step: string; octave: number; alter: number } {
  const source = note.pitch;
  const index = STEPS.indexOf(source.step);
  if (index < 0 || source.step.length !== 1) throw new Error("MusicXML export encountered an invalid pitch step.");
  const staffDistance = interval?.staffDistance ?? 0;
  const halfSteps = interval?.halfSteps ?? 0;
  if (
    ![source.octave, source.alter ?? 0, staffDistance, halfSteps, note.written?.diatonicDelta ?? 0].every(
      Number.isSafeInteger,
    )
  ) {
    throw new Error("MusicXML pitches and transposition must use integer semitones and staff steps.");
  }
  const position = source.octave * 7 + index + staffDistance + (interval ? (note.written?.diatonicDelta ?? 0) : 0);
  const targetIndex = ((position % 7) + 7) % 7;
  const octave = Math.floor(position / 7);
  if (octave < 0 || octave > 9) throw new Error("Transposed pitch is outside MusicXML's octave range (0–9).");
  const sounding = source.octave * 12 + NATURALS[index]! + (source.alter ?? 0);
  return { step: STEPS[targetIndex]!, octave, alter: sounding + halfSteps - octave * 12 - NATURALS[targetIndex]! };
}

export function keyFifths(fifths: number, transposition?: Transposition): number {
  if (!Number.isSafeInteger(fifths)) throw new Error("Invalid key signature in MusicXML export.");
  const interval = transposition?.interval;
  if (!interval) return fifths;
  let shifted = fifths + 7 * interval.halfSteps - 12 * interval.staffDistance;
  const flip = transposition?.keyFifthsFlipAt;
  if (flip !== undefined && flip >= 0 && shifted >= flip) shifted -= 12;
  else if (flip !== undefined && flip < 0 && shifted <= flip) shifted += 12;
  return shifted;
}

export function displayInterval(fifths: number, transposition?: Transposition): Interval | undefined {
  const interval = transposition?.interval;
  if (!interval) return undefined;
  const original = fifths + 7 * interval.halfSteps - 12 * interval.staffDistance;
  const difference = keyFifths(fifths, transposition) - original;
  return { ...interval, staffDistance: interval.staffDistance - difference / 12 };
}

export function transposeElement(context: XmlContext, interval: Interval, tag = "transpose"): XmlElement {
  const octaves = Math.trunc(interval.staffDistance / 7);
  return node(context, tag, [
    node(context, "diatonic", -(interval.staffDistance - octaves * 7)),
    node(context, "chromatic", -(interval.halfSteps - octaves * 12)),
    ...(octaves ? [node(context, "octave-change", -octaves)] : []),
  ]);
}
