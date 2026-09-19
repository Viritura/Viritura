import {
  DURATION_BEATS,
  createDynamicGroup,
  generateId,
  type Duration,
  type DynamicValue,
  type Grace,
  type Markings,
  type NoteEvent,
  type NoteValueBase,
  type SequenceContent,
  type Tuplet,
  type Transposition,
} from "@viritura/core";
import type { Element } from "@xmldom/xmldom";
import type {
  MuseScoreClipboardChordSymbol,
  MuseScoreClipboardDynamic,
  MuseScoreClipboardTrack,
  MuseScoreClipboardData,
} from "./types";
import {
  readNoteConnectors,
  resolveHairpinConnectors,
  resolveNoteConnectors,
  type LocatedDynamic,
  type NoteConnector,
} from "./connectorReading";
import { MuseScoreConversionError, unsupported } from "./errors";
import {
  ZERO,
  add,
  compare,
  formatFraction,
  fraction,
  isZero,
  multiply,
  parseFraction,
  subtract,
  tuple,
  type Fraction,
} from "./fractions";
import { parseHarmony } from "./harmony";
import { noteConnectorOrdinals } from "./noteConnectorOrder";
import { parseMuseScoreNote } from "./noteReading";
import { readRelativeConnector, type RelativeConnector } from "./relativeConnectors";
import { readSlurConnectors, resolveSlurConnectors, type SlurConnector } from "./slurReading";
import { parseStaffTransposition } from "./transposition";
import { child, children, integerText, parseSafeXml, requiredText, text } from "./xml";

export const MUSESCORE_STAFF_LIST_MIME = "application/musescore/stafflist";
export const MUSESCORE_SYMBOL_MIME = "application/musescore/symbol";
export const MUSESCORE_SYMBOL_LIST_MIME = "application/musescore/symbollist";

interface ParsedTrack {
  staffOffset: number;
  voice: number;
  leadIn: Fraction;
  content: SequenceContent[];
  end: Fraction;
  tuplets: TupletFrame[];
}

interface TupletFrame {
  normal: number;
  actual: number;
  base: Duration;
  content: SequenceContent[];
  consumed: Fraction;
}

interface StreamLocation {
  staff: number;
  voice: number;
  time: Fraction;
}

const DURATION_TYPES: Partial<Record<string, NoteValueBase>> = {
  longa: "longa",
  breve: "breve",
  whole: "whole",
  half: "half",
  quarter: "quarter",
  eighth: "eighth",
  "16th": "16th",
  "32nd": "32nd",
  "64th": "64th",
  "128th": "128th",
  "256th": "256th",
  "512th": "512th",
  "1024th": "1024th",
};

const DYNAMIC_VALUES = new Set<DynamicValue>([
  "pppppp",
  "ppppp",
  "pppp",
  "ppp",
  "pp",
  "p",
  "mp",
  "mf",
  "f",
  "ff",
  "fff",
  "ffff",
  "fffff",
  "ffffff",
  "n",
]);

const GRACE_TAGS = new Set([
  "acciaccatura",
  "appoggiatura",
  "grace4",
  "grace16",
  "grace32",
  "grace8after",
  "grace16after",
  "grace32after",
]);

function durationAsWhole(duration: Duration): Fraction {
  let value = fraction(Math.round(DURATION_BEATS[duration.base] * 1024), 4096);
  let addition = value;
  for (let dot = 0; dot < (duration.dots ?? 0); dot++) {
    addition = fraction(addition.numerator, addition.denominator * 2);
    value = add(value, addition);
  }
  return value;
}

function durationForWhole(value: Fraction, path: string): Duration {
  for (const base of Object.values(DURATION_TYPES)) {
    if (!base) continue;
    for (let dots = 0; dots <= 4; dots++) {
      const duration: Duration = dots === 0 ? { base } : { base, dots };
      if (compare(durationAsWhole(duration), value) === 0) return duration;
    }
  }
  throw new MuseScoreConversionError(
    "invalid-timing",
    `duration ${formatFraction(value)} is not representable as a Viritura note value`,
    path,
  );
}

function parseDuration(element: Element, path: string): { duration: Duration; nominal: Fraction } {
  const type = requiredText(element, "durationType", path);
  if (type === "measure") {
    const exact = text(element, "duration");
    if (!exact) unsupported("a measure rest without an explicit duration cannot be interpreted", path);
    const nominal = parseFraction(exact, `${path}/duration`);
    return { duration: durationForWhole(nominal, path), nominal };
  }
  const base = DURATION_TYPES[type];
  if (!base) unsupported(`durationType "${type}" is not supported`, `${path}/durationType`);
  const dots = integerText(element, "dots", `${path}/dots`, 0);
  if (dots < 0 || dots > 4) unsupported(`${dots} augmentation dots are not supported`, path);
  const notated: Duration = dots === 0 ? { base } : { base, dots };
  const exactText = text(element, "duration");
  const nominal = exactText ? parseFraction(exactText, `${path}/duration`) : durationAsWhole(notated);
  const duration = compare(nominal, durationAsWhole(notated)) === 0 ? notated : durationForWhole(nominal, path);
  return { duration, nominal };
}

function parseMarkings(chord: Element, path: string): Markings | undefined {
  const markings: Markings = {};
  for (const articulation of children(chord, "Articulation")) {
    const subtype = requiredText(articulation, "subtype", `${path}/Articulation`);
    switch (subtype.replace(/(?:Above|Below)$/, "")) {
      case "articStaccato":
        markings.staccato = {};
        break;
      case "articTenuto":
        markings.tenuto = {};
        break;
      case "articAccent":
        markings.accent = {};
        break;
      case "articMarcato":
        markings.strongAccent = {};
        break;
      case "articStaccatissimo":
        markings.staccatissimo = {};
        break;
      case "articSpiccato":
        markings.spiccato = {};
        break;
      default:
        unsupported(`articulation "${subtype}" is not supported`, `${path}/Articulation/subtype`);
    }
  }
  for (const symbol of children(chord, "Symbol")) {
    const name = requiredText(symbol, "name", `${path}/Symbol`);
    if (name === "ornamentTrill") markings.trill = {};
    else unsupported(`symbol "${name}" is not supported`, `${path}/Symbol/name`);
  }
  return Object.keys(markings).length > 0 ? markings : undefined;
}

function tupletScale(frames: readonly TupletFrame[]): Fraction {
  return frames.reduce((scale, frame) => multiply(scale, fraction(frame.normal, frame.actual)), fraction(1));
}

function appendContent(
  track: ParsedTrack,
  item: SequenceContent,
  onset: Fraction,
  actualDuration: Fraction,
  path: string,
): void {
  if (compare(onset, track.end) < 0) {
    throw new MuseScoreConversionError(
      "invalid-timing",
      "backward or overlapping rhythmic content",
      path,
      formatFraction(onset),
    );
  }
  if (compare(onset, track.end) > 0) {
    if (track.tuplets.length > 0) unsupported("gaps inside tuplets are not supported", path, formatFraction(onset));
    const gap = subtract(onset, track.end);
    track.content.push({ type: "space", duration: tuple(gap) });
  }
  const destination = track.tuplets.at(-1)?.content ?? track.content;
  destination.push(item);
  track.end = add(onset, actualDuration);
}

function parseChord(
  element: Element,
  track: ParsedTrack,
  onset: Fraction,
  path: string,
  context: StaffListContext,
): { nominal: Fraction; grace: boolean } {
  const { duration, nominal } = parseDuration(element, path);
  const notes = children(element, "Note").map((note, index) =>
    parseMuseScoreNote(note, `${path}/Note[${index}]`, context.transpositions.get(track.staffOffset)),
  );
  if (notes.length === 0) throw new MuseScoreConversionError("invalid-structure", "Chord has no notes", path);
  const markings = parseMarkings(element, path);
  const event: NoteEvent = {
    type: "event",
    id: generateId(),
    duration,
    notes,
    ...(markings ? { markings } : {}),
  };
  const graceTag = children(element).find((candidate) => GRACE_TAGS.has(candidate.tagName));
  const sourceOrdinals = noteConnectorOrdinals(notes);
  for (const [index, noteElement] of children(element, "Note").entries()) {
    context.noteConnectors.push(
      ...readNoteConnectors(
        noteElement,
        notes[index]!,
        { staff: track.staffOffset, voice: track.voice, time: onset, note: sourceOrdinals[index]! },
        Boolean(graceTag),
        `${path}/Note[${index}]/Spanner`,
      ),
    );
  }
  context.slurConnectors.push(
    ...readSlurConnectors(
      element,
      event,
      { staff: track.staffOffset, voice: track.voice, time: onset, note: 0 },
      Boolean(graceTag),
      path,
    ),
  );
  const supported = new Set([
    "durationType",
    "dots",
    "duration",
    "Note",
    "Articulation",
    "Symbol",
    "Spanner",
    ...GRACE_TAGS,
  ]);
  for (const elementChild of children(element)) {
    if (!supported.has(elementChild.tagName)) {
      unsupported(`Chord property "${elementChild.tagName}" is not supported`, `${path}/${elementChild.tagName}`);
    }
  }
  if (graceTag) {
    const afterGrace = graceTag.tagName.endsWith("after");
    const grace: Grace = {
      type: "grace",
      content: [event],
      ...(afterGrace
        ? { graceType: "stealPrevious" as const }
        : graceTag.tagName === "acciaccatura"
          ? { slash: true, graceType: "stealFollowing" as const }
          : { graceType: "stealFollowing" as const }),
    };
    appendContent(track, grace, onset, ZERO, path);
    return { nominal, grace: true };
  }
  const actual = multiply(nominal, tupletScale(track.tuplets));
  appendContent(track, event, onset, actual, path);
  return { nominal, grace: false };
}

function parseRest(
  element: Element,
  track: ParsedTrack,
  onset: Fraction,
  path: string,
  context: StaffListContext,
): Fraction {
  const { duration, nominal } = parseDuration(element, path);
  const supported = new Set(["durationType", "dots", "duration", "staffPosition", "Spanner"]);
  for (const elementChild of children(element)) {
    if (!supported.has(elementChild.tagName)) {
      unsupported(`Rest property "${elementChild.tagName}" is not supported`, `${path}/${elementChild.tagName}`);
    }
  }
  const event: NoteEvent = { type: "event", id: generateId(), duration, rest: {} };
  context.slurConnectors.push(
    ...readSlurConnectors(
      element,
      event,
      { staff: track.staffOffset, voice: track.voice, time: onset, note: 0 },
      false,
      path,
    ),
  );
  appendContent(track, event, onset, multiply(nominal, tupletScale(track.tuplets)), path);
  return nominal;
}

function parseTuplet(element: Element, path: string): TupletFrame {
  const normal = integerText(element, "normalNotes", `${path}/normalNotes`);
  const actual = integerText(element, "actualNotes", `${path}/actualNotes`);
  if (normal <= 0 || actual <= 0 || normal > 128 || actual > 128) {
    throw new MuseScoreConversionError("invalid-timing", "invalid tuplet ratio", path);
  }
  const baseType = requiredText(element, "baseNote", `${path}/baseNote`);
  const base = DURATION_TYPES[baseType];
  if (!base) unsupported(`tuplet baseNote "${baseType}" is not supported`, path);
  const supported = new Set(["normalNotes", "actualNotes", "baseNote"]);
  for (const elementChild of children(element)) {
    if (!supported.has(elementChild.tagName)) {
      unsupported(`Tuplet property "${elementChild.tagName}" is not supported`, `${path}/${elementChild.tagName}`);
    }
  }
  return { normal, actual, base: { base }, content: [], consumed: ZERO };
}

function closeTuplet(track: ParsedTrack, path: string): void {
  const frame = track.tuplets.pop();
  if (!frame) throw new MuseScoreConversionError("invalid-structure", "endTuplet has no matching Tuplet", path);
  if (frame.content.length === 0) throw new MuseScoreConversionError("invalid-structure", "empty Tuplet", path);
  const expected = multiply(durationAsWhole(frame.base), fraction(frame.actual));
  if (compare(frame.consumed, expected) !== 0) {
    throw new MuseScoreConversionError(
      "invalid-timing",
      `incomplete Tuplet contains ${formatFraction(frame.consumed)} instead of ${formatFraction(expected)}`,
      path,
    );
  }
  const tuplet: Tuplet = {
    type: "tuplet",
    inner: { duration: frame.base, multiple: frame.actual },
    outer: { duration: frame.base, multiple: frame.normal },
    content: frame.content,
  };
  const destination = track.tuplets.at(-1)?.content ?? track.content;
  destination.push(tuplet);
  const parent = track.tuplets.at(-1);
  if (parent) parent.consumed = add(parent.consumed, multiply(durationAsWhole(frame.base), fraction(frame.normal)));
}

function applyLocation(
  element: Element,
  location: StreamLocation,
  firstStaff: number,
  staffCount: number,
  path: string,
): void {
  const measures = integerText(element, "measures", `${path}/measures`, 0);
  if (measures !== 0) unsupported("measure-based location deltas cannot be interpreted without source meters", path);
  const grace = integerText(element, "grace", `${path}/grace`, 0);
  const notes = integerText(element, "notes", `${path}/notes`, 0);
  const timeTick = integerText(element, "timeTick", `${path}/timeTick`, 0);
  if (grace !== 0 || notes !== 0 || timeTick !== 0) {
    unsupported("note, grace, and time-tick location anchors are not supported in rhythmic streams", path);
  }
  location.staff += integerText(element, "staves", `${path}/staves`, 0);
  location.voice += integerText(element, "voices", `${path}/voices`, 0);
  const fractionText = text(element, "fractions");
  if (fractionText) location.time = add(location.time, parseFraction(fractionText, `${path}/fractions`));
  if (
    location.staff < firstStaff ||
    location.staff >= firstStaff + staffCount ||
    location.voice < 0 ||
    location.voice > 3
  ) {
    throw new MuseScoreConversionError(
      "invalid-structure",
      "location moved outside the declared staff/voice range",
      path,
    );
  }
  if (compare(location.time, ZERO) < 0) {
    throw new MuseScoreConversionError("invalid-timing", "location moved before the source score start", path);
  }
}

function parseDynamic(element: Element, offset: Fraction, path: string): MuseScoreClipboardDynamic {
  const subtype = requiredText(element, "subtype", `${path}/subtype`) as DynamicValue;
  if (!DYNAMIC_VALUES.has(subtype)) unsupported(`dynamic "${subtype}" is not supported`, path);
  // Source playback settings do not affect Viritura's semantic dynamics.
  const supported = new Set(["subtype", "velocity", "play", "veloChange", "veloChangeSpeed"]);
  for (const elementChild of children(element)) {
    if (!supported.has(elementChild.tagName)) {
      unsupported(`Dynamic property "${elementChild.tagName}" is not supported`, `${path}/${elementChild.tagName}`);
    }
    if (children(elementChild).length > 0 || elementChild.attributes.length > 0) {
      throw new MuseScoreConversionError(
        "invalid-structure",
        `Dynamic ${elementChild.tagName} must be scalar`,
        `${path}/${elementChild.tagName}`,
      );
    }
  }
  const dynamic = createDynamicGroup(subtype, { fraction: [0, 1] });
  return { measureOffset: 0, offset: tuple(offset), dynamic };
}

interface StaffListEnvelope {
  firstStaff: number;
  staffCount: number;
  length: Fraction;
  selectionStart: Fraction;
}

interface StaffListContext extends StaffListEnvelope {
  location: StreamLocation;
  trackMap: Map<string, ParsedTrack>;
  voiceOffsets: Map<string, Fraction>;
  dynamics: MuseScoreClipboardDynamic[];
  chordSymbols: MuseScoreClipboardChordSymbol[];
  locatedDynamics: LocatedDynamic[];
  noteConnectors: NoteConnector[];
  hairpinConnectors: RelativeConnector[];
  slurConnectors: SlurConnector[];
  transpositions: Map<number, Transposition>;
}

function validateStaffListEnvelope(root: Element): StaffListEnvelope {
  if (root.getAttribute("version") !== "4.70") {
    throw new MuseScoreConversionError(
      "unsupported-version",
      `StaffList version "${root.getAttribute("version") ?? ""}" is not supported; expected 4.70`,
      "/StaffList/@version",
    );
  }
  const firstStaff = Number(root.getAttribute("staff"));
  const staffCount = Number(root.getAttribute("staves"));
  if (
    !Number.isInteger(firstStaff) ||
    firstStaff < 0 ||
    !Number.isInteger(staffCount) ||
    staffCount < 1 ||
    staffCount > 128
  ) {
    throw new MuseScoreConversionError("invalid-structure", "invalid StaffList staff range", "/StaffList");
  }
  const timeStretch = root.getAttribute("timeStretch");
  if (timeStretch && compare(parseFraction(timeStretch, "/StaffList/@timeStretch"), fraction(1)) !== 0) {
    unsupported("timeStretch values other than 1/1 are not supported", "/StaffList/@timeStretch");
  }
  const length = parseFraction(root.getAttribute("len") ?? "", "/StaffList/@len");
  if (compare(length, ZERO) <= 0)
    throw new MuseScoreConversionError("invalid-timing", "StaffList len must be positive");
  const selectionStart = parseFraction(root.getAttribute("tick") ?? "", "/StaffList/@tick");
  if (compare(selectionStart, ZERO) < 0) {
    throw new MuseScoreConversionError("invalid-timing", "StaffList tick must not be negative", "/StaffList/@tick");
  }
  return { firstStaff, staffCount, length, selectionStart };
}

function trackForContext(context: StaffListContext): ParsedTrack {
  const key = `${context.location.staff}:${context.location.voice}`;
  let track = context.trackMap.get(key);
  if (track) return track;
  const leadIn = context.voiceOffsets.get(key) ?? ZERO;
  track = {
    staffOffset: context.location.staff - context.firstStaff,
    voice: context.location.voice,
    leadIn,
    content: [],
    end: leadIn,
    tuplets: [],
  };
  context.trackMap.set(key, track);
  return track;
}

function readVoiceOffsets(staff: Element, staffIndex: number, declaredStaff: number, context: StaffListContext): void {
  const voiceOffset = child(staff, "voiceOffset");
  if (!voiceOffset) return;
  for (const voiceElement of children(voiceOffset, "voice")) {
    const voice = Number(voiceElement.getAttribute("id"));
    const ticks = Number(voiceElement.textContent?.trim());
    if (!Number.isInteger(voice) || voice < 0 || voice > 3 || !Number.isSafeInteger(ticks) || ticks < 0) {
      throw new MuseScoreConversionError(
        "invalid-structure",
        "invalid voiceOffset",
        `/StaffList/Staff[${staffIndex}]/voiceOffset`,
      );
    }
    context.voiceOffsets.set(`${declaredStaff}:${voice}`, fraction(ticks, 1920));
  }
}

function parseStaffItem(element: Element, path: string, track: ParsedTrack, context: StaffListContext): void {
  const { location } = context;
  // XML locations are source-absolute; tracks and captured annotations are selection-relative.
  const onset = subtract(location.time, context.selectionStart);
  if (compare(onset, ZERO) < 0) {
    throw new MuseScoreConversionError("invalid-timing", "content occurs before the selection start", path);
  }
  switch (element.tagName) {
    case "Harmony":
      context.chordSymbols.push({
        partOffset: 0,
        staffOffset: track.staffOffset,
        measureOffset: 0,
        offset: tuple(onset),
        chordSymbol: parseHarmony(element, [0, 1], path),
      });
      break;
    case "Dynamic": {
      const captured = { ...parseDynamic(element, onset, path), partOffset: 0, staffOffset: track.staffOffset };
      context.dynamics.push(captured);
      context.locatedDynamics.push({
        captured,
        location: { staff: track.staffOffset, voice: track.voice, time: onset, note: 0 },
      });
      break;
    }
    case "Spanner":
      context.hairpinConnectors.push(
        readRelativeConnector(
          element,
          { staff: track.staffOffset, voice: track.voice, time: onset, note: 0 },
          "HairPin",
          path,
        ),
      );
      break;
    case "Tuplet":
      if (track.tuplets.length === 0 && compare(onset, track.end) > 0) {
        const gap = subtract(onset, track.end);
        appendContent(track, { type: "space", duration: tuple(gap) }, track.end, gap, path);
      }
      track.tuplets.push(parseTuplet(element, path));
      break;
    case "endTuplet":
      closeTuplet(track, path);
      break;
    case "Chord": {
      const parsed = parseChord(element, track, onset, path, context);
      if (!parsed.grace) {
        const frame = track.tuplets.at(-1);
        if (frame) frame.consumed = add(frame.consumed, parsed.nominal);
        location.time = add(location.time, multiply(parsed.nominal, tupletScale(track.tuplets)));
      }
      break;
    }
    case "Rest": {
      const nominal = parseRest(element, track, onset, path, context);
      const frame = track.tuplets.at(-1);
      if (frame) frame.consumed = add(frame.consumed, nominal);
      location.time = add(location.time, multiply(nominal, tupletScale(track.tuplets)));
      break;
    }
    default:
      unsupported(`StaffList element "${element.tagName}" is not supported`, path, formatFraction(location.time));
  }
  if (compare(subtract(location.time, context.selectionStart), context.length) > 0) {
    throw new MuseScoreConversionError("invalid-timing", "rhythmic content exceeds StaffList len", path);
  }
}

function parseStaffElement(staff: Element, staffIndex: number, context: StaffListContext): void {
  const declaredStaff = Number(staff.getAttribute("id"));
  if (
    !Number.isInteger(declaredStaff) ||
    declaredStaff < context.firstStaff ||
    declaredStaff >= context.firstStaff + context.staffCount
  ) {
    throw new MuseScoreConversionError(
      "invalid-structure",
      "Staff id is outside the declared range",
      `/StaffList/Staff[${staffIndex}]`,
    );
  }
  // Each Staff has a fresh track cursor; only the absolute time cursor carries over.
  context.location.staff = declaredStaff;
  context.location.voice = 0;
  const transposition = parseStaffTransposition(staff, `/StaffList/Staff[${staffIndex}]`);
  if (transposition) context.transpositions.set(declaredStaff - context.firstStaff, transposition);
  readVoiceOffsets(staff, staffIndex, declaredStaff, context);
  let itemIndex = 0;
  for (const element of children(staff)) {
    const path = `/StaffList/Staff[${staffIndex}]/${element.tagName}[${itemIndex++}]`;
    if (["voiceOffset", "transposeChromatic", "transposeDiatonic"].includes(element.tagName)) continue;
    if (element.tagName === "location") {
      applyLocation(element, context.location, context.firstStaff, context.staffCount, path);
      continue;
    }
    if (context.location.staff !== declaredStaff) {
      throw new MuseScoreConversionError("invalid-structure", "event stream does not match its Staff id", path);
    }
    parseStaffItem(element, path, trackForContext(context), context);
  }
}

function parseStaffList(root: Element): MuseScoreClipboardData {
  const envelope = validateStaffListEnvelope(root);
  const context: StaffListContext = {
    ...envelope,
    location: { staff: envelope.firstStaff, voice: 0, time: ZERO },
    trackMap: new Map(),
    voiceOffsets: new Map(),
    dynamics: [],
    chordSymbols: [],
    locatedDynamics: [],
    noteConnectors: [],
    hairpinConnectors: [],
    slurConnectors: [],
    transpositions: new Map(),
  };
  const staffs = children(root, "Staff");
  if (staffs.length === 0) throw new MuseScoreConversionError("invalid-structure", "StaffList contains no Staff");
  for (const [staffIndex, staff] of staffs.entries()) parseStaffElement(staff, staffIndex, context);
  resolveSlurConnectors(context.slurConnectors, context.length, context.staffCount);
  resolveNoteConnectors(context.noteConnectors, context.length, context.staffCount);
  context.dynamics = resolveHairpinConnectors(
    context.hairpinConnectors,
    context.locatedDynamics,
    context.length,
    context.staffCount,
  );
  for (const track of context.trackMap.values()) {
    if (track.tuplets.length > 0) {
      throw new MuseScoreConversionError("invalid-structure", "Tuplet is missing endTuplet");
    }
  }
  const parsedTracks = [...context.trackMap.values()]
    .filter((track) => track.content.length > 0)
    .sort((left, right) => left.staffOffset - right.staffOffset || left.voice - right.voice);
  if (parsedTracks.length === 0) unsupported("StaffList contains no rhythmic notes or rests", "/StaffList");
  const tracks: MuseScoreClipboardTrack[] = parsedTracks.map((track) => ({
    partOffset: 0,
    voiceIndex: track.voice,
    staffOffset: track.staffOffset,
    ...(context.transpositions.has(track.staffOffset)
      ? { transposition: context.transpositions.get(track.staffOffset)! }
      : {}),
    ...(isZero(track.leadIn) ? {} : { leadIn: tuple(track.leadIn) }),
    content: track.content,
  }));
  return {
    content: tracks[0]!.content,
    ...(tracks[0]!.transposition ? { transposition: tracks[0]!.transposition } : {}),
    ...(tracks.length > 1 ||
    tracks[0]!.staffOffset !== 0 ||
    tracks[0]!.voiceIndex !== 0 ||
    tracks[0]!.leadIn ||
    tracks[0]!.transposition
      ? { tracks }
      : {}),
    ...(context.dynamics.length > 0 ? { dynamics: context.dynamics } : {}),
    ...(context.chordSymbols.length > 0 ? { chordSymbols: context.chordSymbols } : {}),
  };
}

function parseSingleSymbol(root: Element): MuseScoreClipboardData {
  const noteElement = child(root, "Note");
  const unsupportedItem = children(root).find(
    (element) => element.tagName !== "duration" && element.tagName !== "Note",
  );
  if (unsupportedItem || !noteElement) {
    unsupported(
      `single ${unsupportedItem?.tagName ?? "non-note"} symbols require annotation-selection paste support`,
      "/EngravingItem",
    );
  }
  const durationText = text(root, "duration") ?? "1/4";
  const duration = durationForWhole(parseFraction(durationText, "/EngravingItem/duration"), "/EngravingItem/duration");
  if (children(noteElement, "Spanner").length) {
    unsupported("single-note connectors require a complete StaffList selection", "/EngravingItem/Note/Spanner");
  }
  const note = parseMuseScoreNote(noteElement, "/EngravingItem/Note");
  if (children(noteElement, "Spanner").length > 0) {
    unsupported("single Note connectors require a complete StaffList selection", "/EngravingItem/Note/Spanner");
  }
  return { content: [{ type: "event", id: generateId(), duration, notes: [note] }] };
}

/** Decode MuseScore XML in browsers or Node.js without requiring a global DOMParser. */
export function readMuseScoreClipboard(xml: string, mime?: string): MuseScoreClipboardData {
  const root = parseSafeXml(xml).documentElement;
  const expectedMime =
    root.tagName === "StaffList"
      ? MUSESCORE_STAFF_LIST_MIME
      : root.tagName === "EngravingItem"
        ? MUSESCORE_SYMBOL_MIME
        : root.tagName === "SymbolList"
          ? MUSESCORE_SYMBOL_LIST_MIME
          : undefined;
  if (!expectedMime)
    unsupported(`root element "${root.tagName}" is not a MuseScore clipboard format`, `/${root.tagName}`);
  if (mime && mime !== expectedMime) {
    throw new MuseScoreConversionError("invalid-structure", `MIME ${mime} does not match ${root.tagName}`);
  }
  if (root.tagName === "StaffList") return parseStaffList(root);
  if (root.tagName === "EngravingItem") return parseSingleSymbol(root);
  const version = root.getAttribute("version");
  if (version !== "4.70") {
    throw new MuseScoreConversionError("unsupported-version", `SymbolList version "${version ?? ""}" is not supported`);
  }
  unsupported("MuseScore SymbolList annotation selections are not supported", "/SymbolList");
}

export function looksLikeMuseScoreXml(textValue: string): boolean {
  const start = textValue.trimStart().replace(/^<\?xml[^>]*>\s*/i, "");
  return (
    /^<(?:StaffList|EngravingItem|SymbolList)(?:\s|\/|>|$)/.test(start) ||
    /^<!\s*DOCTYPE\s+(?:StaffList|EngravingItem|SymbolList)\b/i.test(start)
  );
}
