import {
  DURATION_BEATS,
  generateId,
  type Duration,
  type Grace,
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
  MuseScoreClipboardReadOptions,
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
import {
  parseDynamic,
  parseMarkings,
  skipStaffAnnotation,
  validateContainer,
  validateNotationProperties,
} from "./notationReading";
import { ReadPolicy } from "./readPolicy";
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
  validateNotationProperties(
    element,
    ["durationType", "dots", "duration", "Note", "Articulation", "Symbol", "Spanner", ...GRACE_TAGS],
    ["Note", "Articulation", "Symbol", "Spanner"],
    path,
    context.policy,
  );
  const { duration, nominal } = parseDuration(element, path);
  const notes = children(element, "Note").map((note, index) =>
    parseMuseScoreNote(note, `${path}/Note[${index}]`, context.transpositions.get(track.staffOffset), context.policy),
  );
  if (notes.length === 0) throw new MuseScoreConversionError("invalid-structure", "Chord has no notes", path);
  const markings = parseMarkings(element, path, context.policy);
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
        `${path}/Note[${index}]`,
        context.policy,
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
      context.policy,
    ),
  );
  if (children(element).filter((candidate) => GRACE_TAGS.has(candidate.tagName)).length > 1) {
    throw new MuseScoreConversionError("invalid-structure", "Chord has multiple grace types", path);
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
  validateNotationProperties(
    element,
    ["durationType", "dots", "duration", "staffPosition", "Spanner"],
    ["Spanner"],
    path,
    context.policy,
  );
  const { duration, nominal } = parseDuration(element, path);
  const event: NoteEvent = { type: "event", id: generateId(), duration, rest: {} };
  context.slurConnectors.push(
    ...readSlurConnectors(
      element,
      event,
      { staff: track.staffOffset, voice: track.voice, time: onset, note: 0 },
      false,
      path,
      context.policy,
    ),
  );
  appendContent(track, event, onset, multiply(nominal, tupletScale(track.tuplets)), path);
  return nominal;
}

function parseTuplet(element: Element, path: string, policy: ReadPolicy): TupletFrame {
  validateNotationProperties(element, ["normalNotes", "actualNotes", "baseNote"], [], path, policy);
  const normal = integerText(element, "normalNotes", `${path}/normalNotes`);
  const actual = integerText(element, "actualNotes", `${path}/actualNotes`);
  if (normal <= 0 || actual <= 0 || normal > 128 || actual > 128) {
    throw new MuseScoreConversionError("invalid-timing", "invalid tuplet ratio", path);
  }
  const baseType = requiredText(element, "baseNote", `${path}/baseNote`);
  const base = DURATION_TYPES[baseType];
  if (!base) unsupported(`tuplet baseNote "${baseType}" is not supported`, path);
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
  validateContainer(element, [], path);
  const allowed = new Set(["measures", "grace", "notes", "timeTick", "staves", "voices", "fractions"]);
  const seen = new Set<string>();
  for (const item of children(element)) {
    if (!allowed.has(item.tagName) || seen.has(item.tagName) || item.children.length || item.attributes.length) {
      throw new MuseScoreConversionError("invalid-structure", "unknown or malformed stream location field", path);
    }
    seen.add(item.tagName);
  }
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

interface StaffListEnvelope {
  firstStaff: number;
  staffCount: number;
  length: Fraction;
  selectionStart: Fraction;
}

interface StaffListContext extends StaffListEnvelope {
  policy: ReadPolicy;
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
    !/^\d+$/.test(root.getAttribute("staff") ?? "") ||
    !/^\d+$/.test(root.getAttribute("staves") ?? "") ||
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
  const path = `/StaffList/Staff[${staffIndex}]/voiceOffset`;
  const offsets = children(staff, "voiceOffset");
  if (offsets.length > 1) throw new MuseScoreConversionError("invalid-structure", "duplicate voiceOffset", path);
  const voiceOffset = offsets[0];
  if (!voiceOffset) return;
  validateContainer(voiceOffset, [], path);
  if (children(voiceOffset).some((element) => element.tagName !== "voice")) {
    throw new MuseScoreConversionError("invalid-structure", "voiceOffset may contain only voice elements", path);
  }
  const seen = new Set<number>();
  for (const voiceElement of children(voiceOffset, "voice")) {
    if (voiceElement.children.length || voiceElement.attributes.length !== 1 || !voiceElement.hasAttribute("id")) {
      throw new MuseScoreConversionError("invalid-structure", "voiceOffset voice must be a scalar with an id", path);
    }
    const voice = Number(voiceElement.getAttribute("id"));
    const sourceTicks = voiceElement.textContent?.trim() ?? "";
    const ticks = Number(sourceTicks);
    if (
      !/^\d+$/.test(sourceTicks) ||
      !/^[0-3]$/.test(voiceElement.getAttribute("id") ?? "") ||
      !Number.isSafeInteger(ticks) ||
      seen.has(voice)
    ) {
      throw new MuseScoreConversionError("invalid-structure", "invalid voiceOffset", path);
    }
    seen.add(voice);
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
    case "Harmony": {
      const chordSymbol = context.policy.recover(() => parseHarmony(element, [0, 1], path, context.policy));
      if (chordSymbol)
        context.chordSymbols.push({
          partOffset: 0,
          staffOffset: track.staffOffset,
          measureOffset: 0,
          offset: tuple(onset),
          chordSymbol,
        });
      break;
    }
    case "Dynamic": {
      const dynamic = context.policy.recover(() => parseDynamic(element, onset, path, context.policy));
      if (!dynamic) break;
      const captured = { ...dynamic, partOffset: 0, staffOffset: track.staffOffset };
      context.dynamics.push(captured);
      context.locatedDynamics.push({
        captured,
        location: { staff: track.staffOffset, voice: track.voice, time: onset, note: 0 },
      });
      break;
    }
    case "Spanner": {
      const connector = readRelativeConnector(
        element,
        { staff: track.staffOffset, voice: track.voice, time: onset, note: 0 },
        "HairPin",
        path,
        context.policy,
      );
      if (connector) context.hairpinConnectors.push(connector);
      break;
    }
    case "Tuplet":
      if (track.tuplets.length === 0 && compare(onset, track.end) > 0) {
        const gap = subtract(onset, track.end);
        appendContent(track, { type: "space", duration: tuple(gap) }, track.end, gap, path);
      }
      track.tuplets.push(parseTuplet(element, path, context.policy));
      break;
    case "endTuplet":
      validateContainer(element, [], path);
      if (children(element).length)
        throw new MuseScoreConversionError("invalid-structure", "endTuplet must be empty", path);
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
      skipStaffAnnotation(element, path, formatFraction(location.time), context.policy);
  }
  if (compare(subtract(location.time, context.selectionStart), context.length) > 0) {
    throw new MuseScoreConversionError("invalid-timing", "rhythmic content exceeds StaffList len", path);
  }
}

function parseStaffElement(staff: Element, staffIndex: number, context: StaffListContext): void {
  if (context.policy.skipUnsupported) validateContainer(staff, ["id"], `/StaffList/Staff[${staffIndex}]`);
  const declaredStaff = Number(staff.getAttribute("id"));
  if (
    !/^\d+$/.test(staff.getAttribute("id") ?? "") ||
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

function parseStaffList(root: Element, policy: ReadPolicy): MuseScoreClipboardData {
  const envelope = validateStaffListEnvelope(root);
  if (policy.skipUnsupported)
    validateContainer(root, ["version", "tick", "len", "staff", "staves", "timeStretch"], "/StaffList");
  if (children(root).some((element) => element.tagName !== "Staff")) {
    throw new MuseScoreConversionError("invalid-structure", "StaffList may contain only Staff elements", "/StaffList");
  }
  const context: StaffListContext = {
    ...envelope,
    policy,
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
  resolveSlurConnectors(context.slurConnectors, context.length, context.staffCount, policy);
  resolveNoteConnectors(context.noteConnectors, context.length, context.staffCount, policy);
  context.dynamics = resolveHairpinConnectors(
    context.hairpinConnectors,
    context.locatedDynamics,
    context.length,
    context.staffCount,
    policy,
  );
  for (const track of context.trackMap.values()) {
    if (track.tuplets.length > 0) {
      throw new MuseScoreConversionError("invalid-structure", "Tuplet is missing endTuplet");
    }
  }
  const parsedTracks = [...context.trackMap.values()]
    .filter((track) => track.content.length > 0)
    .sort((left, right) => left.staffOffset - right.staffOffset || left.voice - right.voice);
  if (parsedTracks.length === 0) {
    throw new MuseScoreConversionError(
      policy.skipUnsupported ? "empty-content" : "unsupported-content",
      "StaffList contains no rhythmic notes or rests",
      "/StaffList",
    );
  }
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

function parseSingleSymbol(root: Element, policy: ReadPolicy): MuseScoreClipboardData {
  if (policy.skipUnsupported) {
    validateContainer(root, [], "/EngravingItem");
    if (children(root, "Note").length > 1 || children(root, "duration").length > 1) {
      throw new MuseScoreConversionError(
        "invalid-structure",
        "single symbol has duplicate Note or duration",
        "/EngravingItem",
      );
    }
    const durationElement = child(root, "duration");
    if (durationElement && (durationElement.children.length || durationElement.attributes.length)) {
      throw new MuseScoreConversionError("invalid-structure", "duration must be scalar", "/EngravingItem/duration");
    }
  }
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
  if (children(noteElement, "Spanner").length && !policy.skipUnsupported) {
    policy.skip("single-note connectors require a complete StaffList selection", "/EngravingItem/Note/Spanner");
  }
  const note = parseMuseScoreNote(noteElement, "/EngravingItem/Note", undefined, policy);
  if (policy.skipUnsupported) {
    const connectors = readNoteConnectors(
      noteElement,
      note,
      { staff: 0, voice: 0, time: ZERO, note: 0 },
      false,
      "/EngravingItem/Note",
      policy,
    );
    resolveNoteConnectors(connectors, durationAsWhole(duration), 1, policy);
  }
  return { content: [{ type: "event", id: generateId(), duration, notes: [note] }] };
}

/** Decode MuseScore XML in browsers or Node.js without requiring a global DOMParser. */
export function readMuseScoreClipboard(
  xml: string,
  mime?: string,
  options: MuseScoreClipboardReadOptions = {},
): MuseScoreClipboardData {
  const policy = new ReadPolicy(options);
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
  if (root.tagName === "StaffList" || root.tagName === "EngravingItem") {
    const data = root.tagName === "StaffList" ? parseStaffList(root, policy) : parseSingleSymbol(root, policy);
    return policy.diagnostics.length ? { ...data, diagnostics: policy.diagnostics } : data;
  }
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
