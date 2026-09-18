import {
  generateId,
  type AccidentalDisplay,
  type Note,
  type Octave,
  type Pitch,
  type Step,
  type Transposition,
} from "@viritura/core";
import type { Element } from "@xmldom/xmldom";
import { MuseScoreConversionError, unsupported } from "./errors";
import { midiFromPitch, tpcFromPitch } from "./pitch";
import { diatonicPosition, writtenPitchForNote } from "./transposition";
import { child, children, integerText, requiredText } from "./xml";

// MuseScore 4.7.5 (3654226c2e99289916916953a98e585a3d3b315a):
// dom/accidental.cpp, dom/pitchspelling.h, types/typesconv.cpp, rw/read460/tread.cpp.
const ACCIDENTALS: ReadonlyMap<string, number> = new Map([
  ["accidentalTripleFlat", -3],
  ["accidentalDoubleFlat", -2],
  ["accidentalFlat", -1],
  ["accidentalNatural", 0],
  ["accidentalSharp", 1],
  ["accidentalDoubleSharp", 2],
  ["accidentalTripleSharp", 3],
]);
const FIFTHS_STEPS: readonly Step[] = ["F", "C", "G", "D", "A", "E", "B"];

function validateProperties(element: Element, allowed: ReadonlySet<string>, path: string): void {
  if (element.attributes.length) unsupported(`${element.tagName} attributes are not supported`, path);
  for (const node of Array.from(element.childNodes)) {
    if ((node.nodeType === 3 || node.nodeType === 4) && node.textContent?.trim()) {
      throw new MuseScoreConversionError("invalid-structure", `unexpected ${element.tagName} text`, path);
    }
  }
  const seen = new Set<string>();
  for (const property of children(element)) {
    const name = property.tagName;
    const propertyPath = `${path}/${name}`;
    if (!allowed.has(name)) unsupported(`${element.tagName} property "${name}" is not supported`, propertyPath);
    // Connectors own Spanner validation and may legitimately have multiple endpoints.
    if (name === "Spanner") continue;
    if (seen.has(name)) {
      throw new MuseScoreConversionError("invalid-structure", `duplicate ${name}`, propertyPath);
    }
    seen.add(name);
    if (name !== "Accidental" && (property.attributes.length || property.children.length)) {
      throw new MuseScoreConversionError("invalid-structure", `${name} must be a scalar`, propertyPath);
    }
  }
}

function pitchFromTpc(midi: number, tpc: number, path: string): Pitch {
  if (!Number.isSafeInteger(midi) || !Number.isSafeInteger(tpc) || tpc < -8 || tpc > 40) {
    throw new MuseScoreConversionError("invalid-pitch", "pitch or TPC is outside the supported range", path);
  }
  const shifted = tpc - 13;
  const step = FIFTHS_STEPS[((shifted % 7) + 7) % 7]!;
  const alter = Math.floor(shifted / 7);
  const octave = (midi - midiFromPitch({ step, octave: 0 }) - alter) / 12;
  if (!Number.isInteger(octave) || octave < 0 || octave > 9) {
    throw new MuseScoreConversionError(
      "invalid-pitch",
      "MIDI pitch and TPC spelling disagree or exceed native octaves",
      path,
    );
  }
  return { step, octave: octave as Octave, ...(alter === 0 ? {} : { alter }) };
}

function parseWrittenSpelling(
  element: Element,
  note: Note,
  transposition: Transposition | undefined,
  path: string,
): Pitch {
  if (!child(element, "tpc2")) return writtenPitchForNote(note, transposition, path);
  const tpc = integerText(element, "tpc2", `${path}/tpc2`);
  const writtenMidi = midiFromPitch(note.pitch) + (transposition?.interval.halfSteps ?? 0);
  const written = pitchFromTpc(writtenMidi, tpc, `${path}/tpc2`);
  const delta = diatonicPosition(written) - diatonicPosition(note.pitch) - (transposition?.interval.staffDistance ?? 0);
  if (delta !== 0) {
    if (!transposition) {
      unsupported(
        "tpc2 spelling without source transposition cannot preserve both concert and written pitch",
        `${path}/tpc2`,
      );
    }
    note.written = { diatonicDelta: delta };
  }
  writtenPitchForNote(note, transposition, path);
  return written;
}

function parseAccidental(element: Element, written: Pitch, concert: Pitch, path: string): AccidentalDisplay {
  validateProperties(element, new Set(["subtype", "bracket", "role", "visible", "small", "stackingOrderOffset"]), path);
  const subtype = requiredText(element, "subtype", `${path}/subtype`);
  const alter = ACCIDENTALS.get(subtype);
  if (alter === undefined) unsupported(`accidental subtype "${subtype}" is not supported`, `${path}/subtype`);
  // StaffList does not identify Concert Pitch view; the displayed glyph may
  // describe either spelling, while MIDI and the two TPCs remain authoritative.
  if (alter !== (written.alter ?? 0) && alter !== (concert.alter ?? 0)) {
    throw new MuseScoreConversionError(
      "invalid-pitch",
      "explicit accidental contradicts written pitch and concert pitch",
      `${path}/subtype`,
    );
  }
  const bracket = integerText(element, "bracket", `${path}/bracket`, 0);
  if (bracket < 0 || bracket > 2) unsupported(`accidental bracket "${bracket}" is not supported`, `${path}/bracket`);
  const role = integerText(element, "role", `${path}/role`, 0);
  if (role !== 0 && role !== 1) unsupported(`accidental role "${role}" is not supported`, `${path}/role`);
  const visible = integerText(element, "visible", `${path}/visible`, 1);
  if (visible !== 0 && visible !== 1) {
    throw new MuseScoreConversionError("invalid-structure", "accidental visible must be 0 or 1", `${path}/visible`);
  }
  for (const name of ["small", "stackingOrderOffset"]) {
    if (integerText(element, name, `${path}/${name}`, 0) !== 0) {
      unsupported(`accidental ${name} cannot be represented by the native display model`, `${path}/${name}`);
    }
  }
  return {
    show: visible === 1,
    force: role === 1,
    ...(bracket === 0 ? {} : { enclosure: { symbol: bracket === 1 ? "parentheses" : "brackets" } }),
  };
}

export function parseMuseScoreNote(element: Element, path: string, transposition?: Transposition): Note {
  validateProperties(element, new Set(["pitch", "tpc", "tpc2", "Accidental", "Spanner"]), path);
  const midi = integerText(element, "pitch", `${path}/pitch`);
  if (midi < 0 || midi > 127) {
    throw new MuseScoreConversionError("invalid-pitch", "pitch is outside MIDI range", `${path}/pitch`);
  }
  const tpc = integerText(element, "tpc", `${path}/tpc`);
  const note: Note = { id: generateId(), pitch: pitchFromTpc(midi, tpc, path) };
  const written = parseWrittenSpelling(element, note, transposition, path);
  const accidental = child(element, "Accidental");
  if (accidental) note.accidentalDisplay = parseAccidental(accidental, written, note.pitch, `${path}/Accidental`);
  return note;
}

function validateNativeFields(value: object, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      unsupported(`native property "${key}" cannot be preserved in MuseScore XML`, `${path}/${key}`);
  }
}

export function accidentalXml(note: Note, path: string, transposition?: Transposition): string {
  const display = note.accidentalDisplay;
  if (!display) return "";
  validateNativeFields(display, new Set(["show", "force", "enclosure"]), `${path}/accidentalDisplay`);
  if (typeof display.show !== "boolean" || (display.force !== undefined && typeof display.force !== "boolean")) {
    throw new MuseScoreConversionError("invalid-structure", "accidental display requires boolean show/force", path);
  }
  const written = writtenPitchForNote(note, transposition, path);
  const subtype = Array.from(ACCIDENTALS).find(([, alter]) => alter === (written.alter ?? 0))?.[0];
  if (!subtype) unsupported("native accidental cannot be represented by a standard MuseScore subtype", path);
  let bracket = "";
  if (display.enclosure) {
    validateNativeFields(display.enclosure, new Set(["symbol"]), `${path}/accidentalDisplay/enclosure`);
    if (display.enclosure.symbol !== "parentheses" && display.enclosure.symbol !== "brackets") {
      unsupported("native accidental enclosure cannot be represented in MuseScore XML", path);
    }
    bracket = `<bracket>${display.enclosure.symbol === "parentheses" ? 1 : 2}</bracket>`;
  }
  const role = `<role>${display.force ? 1 : 0}</role>`;
  const visible = display.show ? "" : "<visible>0</visible>";
  return `<Accidental>${bracket}${role}<subtype>${subtype}</subtype>${visible}</Accidental>`;
}

/** Inner Note XML only; the stream writer owns the wrapper, ties and other connectors. */
export function notePitchXml(note: Note, path: string, transposition?: Transposition): string {
  const midi = midiFromPitch(note.pitch);
  const tpc = tpcFromPitch(note.pitch);
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new MuseScoreConversionError("invalid-pitch", "pitch is outside MIDI range", path);
  }
  const decoded = pitchFromTpc(midi, tpc, path);
  if (
    decoded.step !== note.pitch.step ||
    decoded.octave !== note.pitch.octave ||
    (decoded.alter ?? 0) !== (note.pitch.alter ?? 0)
  ) {
    unsupported("native concert spelling cannot be represented by a MuseScore TPC", path);
  }
  if (note.written) validateNativeFields(note.written, new Set(["diatonicDelta"]), `${path}/written`);
  const written = writtenPitchForNote(note, transposition, path);
  const tpc2 = tpcFromPitch(written);
  return (
    accidentalXml(note, path, transposition) +
    `<pitch>${midi}</pitch><tpc>${tpc}</tpc>` +
    (tpc2 === tpc && !note.written?.diatonicDelta ? "" : `<tpc2>${tpc2}</tpc2>`)
  );
}
