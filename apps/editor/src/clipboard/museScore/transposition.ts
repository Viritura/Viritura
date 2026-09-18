import type { Note, Octave, Pitch, Step, Transposition } from "@viritura/core";
import { MuseScoreConversionError, unsupported } from "./errors";
import { midiFromPitch } from "./pitch";
import { children, integerText } from "./xml";

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];

function transposeComponent(staff: Element, name: string, path: string): number {
  const elements = children(staff, name);
  if (elements.length > 1) {
    throw new MuseScoreConversionError("invalid-structure", `duplicate ${name}`, `${path}/${name}`);
  }
  const element = elements[0];
  if (element && (element.attributes.length || element.children.length)) {
    throw new MuseScoreConversionError("invalid-structure", `${name} must be an integer scalar`, `${path}/${name}`);
  }
  const value = integerText(staff, name, `${path}/${name}`, 0);
  // read460 stores both source interval components in signed eight-bit integers.
  if (value < -128 || value > 127) {
    throw new MuseScoreConversionError(
      "invalid-structure",
      `${name} exceeds MuseScore's interval range`,
      `${path}/${name}`,
    );
  }
  return value;
}

export function parseStaffTransposition(staff: Element, path: string): Transposition | undefined {
  const chromatic = transposeComponent(staff, "transposeChromatic", path);
  const diatonic = transposeComponent(staff, "transposeDiatonic", path);
  // select.cpp omits each zero component independently. Its interval is written→sounding.
  if (chromatic === 0 && diatonic === 0) return undefined;
  const halfSteps = chromatic === 0 ? 0 : -chromatic;
  const staffDistance = diatonic === 0 ? 0 : -diatonic;
  const pureOctaves = halfSteps !== 0 && halfSteps % 12 === 0 && halfSteps * 7 === staffDistance * 12;
  return {
    interval: { halfSteps, staffDistance },
    ...(pureOctaves ? { prefersWrittenPitches: true } : {}),
  };
}

function validateTransposition(transposition: Transposition | undefined, path: string): void {
  if (!transposition) return;
  for (const name of ["halfSteps", "staffDistance"] as const) {
    const value = transposition.interval[name];
    if (!Number.isSafeInteger(value) || value < -127 || value > 128) {
      throw new MuseScoreConversionError("invalid-structure", `invalid transposition ${name}`, path);
    }
  }
  if (transposition.keyFifthsFlipAt !== undefined) {
    unsupported("keyFifthsFlipAt requires key-context spelling that StaffList export cannot preserve", path);
  }
}

export function staffTranspositionXml(transposition: Transposition | undefined, path: string): string {
  validateTransposition(transposition, path);
  if (!transposition) return "";
  const { halfSteps, staffDistance } = transposition.interval;
  return (
    (halfSteps === 0 ? "" : `<transposeChromatic>${-halfSteps}</transposeChromatic>`) +
    (staffDistance === 0 ? "" : `<transposeDiatonic>${-staffDistance}</transposeDiatonic>`)
  );
}

export function diatonicPosition(pitch: Pitch): number {
  return pitch.octave * 7 + STEPS.indexOf(pitch.step);
}

/** Compute display spelling only; the note's authoritative concert pitch is never mutated. */
export function writtenPitchForNote(note: Note, transposition: Transposition | undefined, path: string): Pitch {
  validateTransposition(transposition, path);
  const delta = note.written?.diatonicDelta ?? 0;
  if (!Number.isSafeInteger(delta)) {
    throw new MuseScoreConversionError("invalid-structure", "written.diatonicDelta must be an integer", path);
  }
  const hasInterval =
    transposition && (transposition.interval.halfSteps !== 0 || transposition.interval.staffDistance !== 0);
  if (!hasInterval && delta !== 0) {
    unsupported("written spelling without source transposition cannot preserve both concert and written pitch", path);
  }
  const position = diatonicPosition(note.pitch) + (transposition?.interval.staffDistance ?? 0) + delta;
  const octave = Math.floor(position / 7);
  if (!Number.isSafeInteger(position) || octave < 0 || octave > 9) {
    unsupported("written pitch is outside the native octave range", path);
  }
  const step = STEPS[((position % 7) + 7) % 7]!;
  const natural: Pitch = { step, octave: octave as Octave };
  const alter = midiFromPitch(note.pitch) + (transposition?.interval.halfSteps ?? 0) - midiFromPitch(natural);
  if (!Number.isInteger(alter) || Math.abs(alter) > 3) {
    unsupported("written pitch requires an accidental outside MuseScore's standard triple-accidental range", path);
  }
  return alter === 0 ? natural : { ...natural, alter };
}
