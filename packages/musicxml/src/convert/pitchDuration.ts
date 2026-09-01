import { TYPE_MAP, CLEF_POSITIONS, DURATION_FROM_FRACTION } from "../constants";
import { Fraction } from "../fraction";
import { childText, findChild, findChildren } from "../xmlHelpers";
import type { MnxClef, MnxDuration, MnxPitch, MnxPositionedClef, MnxRhythmicPosition } from "../types";
import { normalizeMusicXmlColor } from "./colors";

/**
 * MusicXML `<transpose>` interval: written + interval = sounding.
 * For Bb clarinet: { halfSteps: -2, staffDistance: -1, octaveChange: 0 }.
 */
export interface TransposeInterval {
  halfSteps: number;
  staffDistance: number;
  octaveChange: number;
}

const STEPS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const STEP_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function convertNoteType(mxmlType: string, dots: number): MnxDuration {
  const base = TYPE_MAP[mxmlType] ?? mxmlType;
  const result: MnxDuration = { base };
  if (dots > 0) result.dots = dots;
  return result;
}

export function convertPitch(pitchEl: Element, transpose?: TransposeInterval): MnxPitch {
  const step = childText(pitchEl, "step") ?? "C";
  const octave = parseInt(childText(pitchEl, "octave") ?? "4", 10);
  const alterText = childText(pitchEl, "alter");
  const alter = alterText !== null ? Math.round(parseFloat(alterText)) : 0;
  const written: MnxPitch = { step, octave };
  if (alter !== 0) written.alter = alter;
  if (!transpose) return written;
  return transposeWrittenToSounding(written, transpose);
}

/** MIDI note number for a natural pitch (no alter). */
function naturalMidi(step: string, octave: number): number {
  return (octave + 1) * 12 + (STEP_TO_PC[step] ?? 0);
}

/**
 * Convert a written pitch from MusicXML into the sounding pitch MNX expects
 * to store. MNX stores sounding pitches and uses `part.transposition` to tell
 * the renderer how to reverse-transpose for "written" view.
 *
 * Reference: MusicXML 4.0 spec, `<transpose>`:
 *   written-pitch + chromatic semitones (+ 12 * octave-change) = sounding-pitch.
 *   Diatonic gives the staff-step distance (signed).
 */
function transposeWrittenToSounding(written: MnxPitch, t: TransposeInterval): MnxPitch {
  const writtenStepIdx = STEPS.indexOf(written.step as (typeof STEPS)[number]);
  if (writtenStepIdx < 0) return written;

  const totalSteps = writtenStepIdx + t.staffDistance + written.octave * 7;
  const newStepIdx = ((totalSteps % 7) + 7) % 7;
  const newOctaveBase = Math.floor(totalSteps / 7);
  const newOctave = newOctaveBase + t.octaveChange;
  const newStep = STEPS[newStepIdx]!;

  const writtenMidi = naturalMidi(written.step, written.octave) + (written.alter ?? 0);
  const soundingMidi = writtenMidi + t.halfSteps + 12 * t.octaveChange;
  const newAlter = soundingMidi - naturalMidi(newStep, newOctave);

  const result: MnxPitch = { step: newStep, octave: newOctave };
  if (newAlter !== 0) result.alter = newAlter;
  return result;
}

function convertClef(sign: string, line: string, octaveChange?: string | null): MnxClef {
  const key = `${sign}-${line}`;
  let position = CLEF_POSITIONS[key];
  if (position === undefined) {
    position = (parseInt(line, 10) - 3) * 2;
  }
  const clef: MnxClef = { sign, staffPosition: position };
  if (octaveChange) {
    const oc = parseInt(octaveChange, 10);
    if (oc !== 0) clef.octave = oc;
  }
  return clef;
}

/**
 * Convert a MusicXML `<clef>` element into an MNX positioned clef. `position`
 * is the rhythmic offset from the measure start; pass it for mid-measure clef
 * changes and omit it for measure-initial clefs (which MNX leaves unpositioned).
 */
export function clefFromElement(c: Element, position?: MnxRhythmicPosition): MnxPositionedClef {
  const sign = childText(c, "sign") ?? "G";
  const line = childText(c, "line") ?? "2";
  const octaveChange = childText(c, "clef-octave-change");
  const clefStaff = c.getAttribute("number");

  let clef: MnxClef;
  if (sign === "percussion") {
    // MNX-compliant percussion clef: valid sign + SMuFL glyph override.
    clef = { sign: "G", staffPosition: 0, glyph: "unpitchedPercussionClef1" };
  } else if (sign === "TAB") {
    // No Viritura implementation for TAB — always fall back to G clef.
    clef = convertClef("G", "2", null);
  } else {
    clef = convertClef(sign, line, octaveChange);
  }

  const result: MnxPositionedClef = { clef };
  const color = normalizeMusicXmlColor(c.getAttribute("color"));
  if (color) result.clef.color = color;
  if (clefStaff) result.staff = parseInt(clefStaff, 10);
  if (position) result.position = position;
  return result;
}

function fractionToDuration(frac: Fraction): MnxDuration {
  return DURATION_FROM_FRACTION[frac.key()] ?? { base: "whole" };
}

export function makePosition(frac: Fraction): MnxRhythmicPosition {
  return { fraction: frac.toMnxFraction() };
}

export function computeNoteDuration(noteEl: Element, divisions: number): { durObj: MnxDuration; advance: Fraction } {
  const noteType = findChild(noteEl, "type");
  const dots = findChildren(noteEl, "dot").length;
  const durEl = findChild(noteEl, "duration");

  let durObj: MnxDuration;
  if (noteType) {
    durObj = convertNoteType(noteType.textContent ?? "quarter", dots);
  } else if (durEl) {
    const durFrac = new Fraction(parseInt(durEl.textContent ?? "1", 10), divisions * 4);
    durObj = fractionToDuration(durFrac);
  } else {
    durObj = { base: "quarter" };
  }

  let advance = Fraction.ZERO;
  if (durEl) {
    advance = new Fraction(parseInt(durEl.textContent ?? "0", 10), divisions * 4);
  }

  return { durObj, advance };
}
