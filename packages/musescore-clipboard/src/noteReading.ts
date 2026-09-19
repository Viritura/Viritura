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
import { validateDecoration } from "./notationReading";
import { midiFromPitch, tpcFromPitch } from "./pitch";
import type { ReadPolicy } from "./readPolicy";
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

const NOTE_PROPERTIES = new Set(["pitch", "tpc", "tpc2", "Accidental", "Spanner"]);
const ACCIDENTAL_PROPERTIES = new Set(["subtype", "bracket", "role", "visible", "small", "stackingOrderOffset"]);
const VISUAL_PROPERTIES = new Set(["color", "offset", "pos", "autoplace", "z", "placement"]);
const NOTE_EMBELLISHMENTS = new Set([
  "Fingering",
  "Symbol",
  "Image",
  "Text",
  "Bend",
  "Ornament",
  "Articulation",
  "NoteDot",
]);
const NOTE_NON_RHYTHMIC_PROPERTIES = new Set([
  "head",
  "headType",
  "headGroup",
  "headScheme",
  "headHasParentheses",
  "velocity",
  "veloType",
  "veloOffset",
  "velocityType",
  "tuning",
  "fret",
  "string",
  "ghost",
  "small",
  "mirror",
  "dotPosition",
  "play",
  "visible",
  "fixed",
  "fixedLine",
  "line",
  "deadNote",
  ...VISUAL_PROPERTIES,
  ...NOTE_EMBELLISHMENTS,
]);

interface ReadLoss {
  message: string;
  path?: string;
}

interface WrittenSpelling {
  pitch: Pick<Pitch, "alter">;
  discarded: boolean;
}

function validateProperties(
  element: Element,
  allowed: ReadonlySet<string>,
  skippable: ReadonlySet<string>,
  path: string,
  losses: ReadLoss[],
  policy?: ReadPolicy,
): void {
  if (element.attributes.length) {
    if (policy?.skipUnsupported) {
      throw new MuseScoreConversionError("invalid-structure", `unknown ${element.tagName} attributes`, path);
    }
    losses.push({ message: `${element.tagName} attributes are not supported`, path });
  }
  for (const node of Array.from(element.childNodes)) {
    if ((node.nodeType === 3 || node.nodeType === 4) && node.textContent?.trim()) {
      throw new MuseScoreConversionError("invalid-structure", `unexpected ${element.tagName} text`, path);
    }
  }
  const seen = new Set<string>();
  for (const property of children(element)) {
    const name = property.tagName;
    const propertyPath = `${path}/${name}`;
    if (!allowed.has(name)) {
      if (!skippable.has(name) && policy?.skipUnsupported) {
        throw new MuseScoreConversionError(
          "invalid-structure",
          `unknown ${element.tagName} property "${name}"`,
          propertyPath,
        );
      }
      losses.push({ message: `${element.tagName} property "${name}" is not supported`, path: propertyPath });
      if (!skippable.has(name)) continue;
      validateDecoration(property, propertyPath);
      if (VISUAL_PROPERTIES.has(name) || NOTE_EMBELLISHMENTS.has(name)) continue;
    }
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

function decodeSpelling(midi: number, tpc: number, path: string): { step: Step; alter: number; octave: number } {
  if (!Number.isSafeInteger(midi) || !Number.isSafeInteger(tpc) || tpc < -8 || tpc > 40) {
    throw new MuseScoreConversionError("invalid-pitch", "pitch or TPC is outside the supported range", path);
  }
  const shifted = tpc - 13;
  const step = FIFTHS_STEPS[((shifted % 7) + 7) % 7]!;
  const alter = Math.floor(shifted / 7);
  const octave = (midi - midiFromPitch({ step, octave: 0 }) - alter) / 12;
  if (!Number.isInteger(octave)) {
    throw new MuseScoreConversionError("invalid-pitch", "MIDI pitch and TPC spelling disagree", path);
  }
  return { step, alter, octave };
}

function pitchFromTpc(midi: number, tpc: number, path: string): Pitch {
  const { step, alter, octave } = decodeSpelling(midi, tpc, path);
  if (octave < 0 || octave > 9) {
    throw new MuseScoreConversionError("invalid-pitch", "MIDI pitch and TPC spelling exceed native octaves", path);
  }
  return { step, octave: octave as Octave, ...(alter === 0 ? {} : { alter }) };
}

function parseWrittenSpelling(
  element: Element,
  note: Note,
  transposition: Transposition | undefined,
  path: string,
  losses: ReadLoss[],
): WrittenSpelling {
  // Decode the source spelling before attempting its native representation, so
  // even a discarded written override can validate the source accidental.
  const decoded = child(element, "tpc2")
    ? decodeSpelling(
        midiFromPitch(note.pitch) + (transposition?.interval.halfSteps ?? 0),
        integerText(element, "tpc2", `${path}/tpc2`),
        `${path}/tpc2`,
      )
    : undefined;
  if (decoded && (decoded.octave < 0 || decoded.octave > 9)) {
    losses.push({ message: "written pitch is outside the native octave range", path: `${path}/tpc2` });
    return { pitch: decoded, discarded: true };
  }
  const written = decoded ? { ...decoded, octave: decoded.octave as Octave } : undefined;
  try {
    if (!written) return { pitch: writtenPitchForNote(note, transposition, path), discarded: false };
    const delta =
      diatonicPosition(written) - diatonicPosition(note.pitch) - (transposition?.interval.staffDistance ?? 0);
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
  } catch (error) {
    if (!(error instanceof MuseScoreConversionError) || error.code !== "unsupported-content") throw error;
    losses.push(error);
    delete note.written;
    return { pitch: written ?? note.pitch, discarded: true };
  }
  return { pitch: written, discarded: false };
}

function parseAccidental(
  element: Element,
  written: WrittenSpelling,
  concert: Pitch,
  path: string,
  losses: ReadLoss[],
  policy?: ReadPolicy,
): AccidentalDisplay | undefined {
  validateProperties(element, ACCIDENTAL_PROPERTIES, VISUAL_PROPERTIES, path, losses, policy);
  const subtype = requiredText(element, "subtype", `${path}/subtype`);
  const alter = ACCIDENTALS.get(subtype);
  if (alter === undefined) {
    losses.push({ message: `accidental subtype "${subtype}" is not supported`, path: `${path}/subtype` });
  }
  // StaffList does not identify Concert Pitch view; the displayed glyph may
  // describe either spelling, while MIDI and the two TPCs remain authoritative.
  if (alter !== undefined && alter !== (written.pitch.alter ?? 0) && alter !== (concert.alter ?? 0)) {
    throw new MuseScoreConversionError(
      "invalid-pitch",
      "explicit accidental contradicts written pitch and concert pitch",
      `${path}/subtype`,
    );
  }
  const bracket = integerText(element, "bracket", `${path}/bracket`, 0);
  const supportedBracket = bracket >= 0 && bracket <= 2;
  if (!supportedBracket) {
    losses.push({ message: `accidental bracket "${bracket}" is not supported`, path: `${path}/bracket` });
  }
  const role = integerText(element, "role", `${path}/role`, 0);
  const supportedRole = role === 0 || role === 1;
  if (!supportedRole) {
    losses.push({ message: `accidental role "${role}" is not supported`, path: `${path}/role` });
  }
  const visible = integerText(element, "visible", `${path}/visible`, 1);
  if (visible !== 0 && visible !== 1) {
    throw new MuseScoreConversionError("invalid-structure", "accidental visible must be 0 or 1", `${path}/visible`);
  }
  for (const name of ["small", "stackingOrderOffset"]) {
    if (integerText(element, name, `${path}/${name}`, 0) !== 0) {
      losses.push({
        message: `accidental ${name} cannot be represented by the native display model`,
        path: `${path}/${name}`,
      });
    }
  }
  if (alter === undefined) return undefined;
  if (written.discarded && alter !== (concert.alter ?? 0)) {
    losses.push({ message: "accidental display requires the discarded written spelling", path: `${path}/subtype` });
    return undefined;
  }
  return {
    show: visible === 1,
    ...(supportedRole ? { force: role === 1 } : {}),
    ...(!supportedBracket || bracket === 0
      ? {}
      : { enclosure: { symbol: bracket === 1 ? "parentheses" : "brackets" } }),
  };
}

export function parseMuseScoreNote(
  element: Element,
  path: string,
  transposition?: Transposition,
  policy?: ReadPolicy,
): Note {
  const losses: ReadLoss[] = [];
  validateProperties(element, NOTE_PROPERTIES, NOTE_NON_RHYTHMIC_PROPERTIES, path, losses, policy);
  const midi = integerText(element, "pitch", `${path}/pitch`);
  if (midi < 0 || midi > 127) {
    throw new MuseScoreConversionError("invalid-pitch", "pitch is outside MIDI range", `${path}/pitch`);
  }
  const tpc = integerText(element, "tpc", `${path}/tpc`);
  const note: Note = { id: generateId(), pitch: pitchFromTpc(midi, tpc, path) };
  const written = parseWrittenSpelling(element, note, transposition, path, losses);
  const accidental = child(element, "Accidental");
  if (accidental) {
    const display = parseAccidental(accidental, written, note.pitch, `${path}/Accidental`, losses, policy);
    if (display) note.accidentalDisplay = display;
  }
  // Unsupported decorations must never short-circuit validation of supported data.
  for (const loss of losses) {
    if (policy) policy.skip(loss.message, loss.path);
    else unsupported(loss.message, loss.path);
  }
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
