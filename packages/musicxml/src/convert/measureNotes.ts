import { TYPE_MAP } from "../constants";
import { createDynamicGroup } from "@viritura/core";
import { Fraction } from "../fraction";
import { childElements, childText, findChild, findChildren, notationChildren } from "../xmlHelpers";
import type {
  MnxBeam,
  MnxDuration,
  MnxDynamic,
  MnxEvent,
  MnxGraceEvent,
  MnxMultiNoteTremolo,
  MnxPositionedClef,
  MnxRhythmicPosition,
  MnxSequenceContent,
  MnxSpace,
  MnxTie,
  MnxTuplet,
} from "../types";
import { IdGenerator } from "./idGenerator";
import {
  buildNote,
  extractFermata,
  extractLyrics,
  extractMarkings,
  extractSlurs,
  resolveSlurStopId,
  type SlurState,
} from "./notes";
import { clefFromElement, computeNoteDuration, makePosition, type TransposeInterval } from "./pitchDuration";

/** Per-note conversion flags resolved from `ConvertOptions`. Distinct from
 *  `vendorExt` (which gates `_x.viritura` output) — these toggle how authored
 *  MusicXML detail is mapped into MNX. */
export interface ConvertFlags {
  /** Drop explicit `<stem>up|down</stem>` overrides; let the engine decide. */
  discardStemDirections?: boolean;
}

/** A crescendo/decrescendo wedge boundary (start or stop). Paired into a
 *  single `hairpin` span (with an `end`) by the part-level walker. */
interface HairpinEvent {
  action: "start" | "stop";
  /** Present on `start`. */
  hairpinType?: "crescendo" | "decrescendo";
  position: MnxRhythmicPosition;
  staff?: number;
  voice?: string;
}

/** A pedal boundary (start or stop). Paired into a single `pedal` span by the
 *  part-level walker. */
interface PedalEvent {
  action: "start" | "stop";
  /** Present on `start`. */
  pedalType?: "sustain" | "sostenuto";
  position: MnxRhythmicPosition;
  staff?: number;
}

/** An octave-shift boundary (start or stop). Paired into a single `ottava`
 *  span (with an `end`) by the part-level walker, so a shift may begin in one
 *  measure and end in a later one — the per-measure pairing this replaced
 *  silently dropped any `stop` that landed in a different measure. */
export interface OttavaEvent {
  action: "start" | "stop";
  /** Present on `start`: 1, -1, 2, -2. */
  value?: number;
  position: MnxRhythmicPosition;
  staff?: number;
}

export interface MeasureResult {
  voices: Map<string, MnxSequenceContent[]>;
  voiceStaves: Map<string, number>;
  clefs: MnxPositionedClef[];
  dynamics: MnxDynamic[];
  ottavaEvents: OttavaEvent[];
  beamGroups: MnxBeam[];
  rehearsals: { text: string; position: MnxRhythmicPosition }[];
  expressions: { text: string; position: MnxRhythmicPosition; placement?: "above" | "below"; staff?: number }[];
  hairpinEvents: HairpinEvent[];
  pedalEvents: PedalEvent[];
}

interface TupletAccumulator {
  actualNotes: number;
  normalNotes: number;
  normalType: string;
  events: MnxSequenceContent[];
  bracket?: boolean;
  /** From MusicXML <tuplet show-number="none|actual|both"> — maps to MNX `showNumber`. */
  showNumber?: "noNumber" | "inner" | "both";
  /** From MusicXML <tuplet show-type="none|actual|both"> — maps to MNX `showValue`. */
  showValue?: "noValue" | "inner" | "both";
}

// MNX note-value base → fraction of a whole note.
const BASE_FRACTION: Record<string, [number, number]> = {
  maxima: [4, 1],
  longa: [2, 1],
  breve: [2, 1],
  whole: [1, 1],
  half: [1, 2],
  quarter: [1, 4],
  eighth: [1, 8],
  "16th": [1, 16],
  "32nd": [1, 32],
  "64th": [1, 64],
  "128th": [1, 128],
  "256th": [1, 256],
  "512th": [1, 512],
  "1024th": [1, 1024],
};

function baseToFraction(base: string): Fraction | undefined {
  const v = BASE_FRACTION[base];
  return v ? new Fraction(v[0], v[1]) : undefined;
}

/** Reverse of `baseToFraction`: the MNX note-value base for a plain (un-dotted)
 *  fraction of a whole note, or undefined if it isn't an exact power-of-two
 *  note value. */
function fractionToBase(f: Fraction): string | undefined {
  for (const [base, v] of Object.entries(BASE_FRACTION)) {
    if (f.n === v[0] && f.d === v[1]) return base;
  }
  return undefined;
}

/** Larger of two fractions. */
function fracMax(a: Fraction, b: Fraction): Fraction {
  return a.subtract(b).isNegative() ? b : a;
}

/** Written duration of a note value, including augmentation dots. */
function durationToFraction(d: MnxDuration): Fraction | undefined {
  const f = baseToFraction(d.base);
  if (!f) return undefined;
  const dots = d.dots ?? 0;
  if (dots === 0) return f;
  // Dotted value = base × (2^(dots+1) − 1) / 2^dots.
  const num = (1 << (dots + 1)) - 1;
  const den = 1 << dots;
  return new Fraction(f.n * num, f.d * den);
}

/** Sum of the written (notated) durations of a tuplet's content. */
function writtenContentBeats(content: MnxSequenceContent[]): Fraction | undefined {
  let total = Fraction.ZERO;
  for (const c of content) {
    if ("type" in c && c.type === "tuplet") {
      // A nested tuplet contributes its notated (outer) written duration.
      const od = durationToFraction(c.outer.duration);
      if (!od) return undefined;
      total = total.add(new Fraction(od.n * c.outer.multiple, od.d));
    } else if ("type" in c && c.type === "space") {
      total = total.add(new Fraction(c.duration[0], c.duration[1]));
    } else if ("type" in c && c.type === "grace") {
      // Grace events occupy no metric time.
    } else if ("duration" in c) {
      const ed = durationToFraction(c.duration);
      if (!ed) return undefined;
      total = total.add(ed);
    }
  }
  return total;
}

/**
 * Build the MNX tuplet from an accumulator.
 *
 * MusicXML `time-modification` gives the *reduced* ratio (e.g. 5:4) on each
 * note, but a single tuplet bracket may span an integer multiple of that
 * ratio — e.g. ten 32nds engraved under one 5:4 bracket. MNX's inner/outer
 * `multiple` describe the actual unit counts, so we derive them from the
 * accumulated content rather than copying the reduced ratio verbatim. Both
 * inner and outer share the tuplet's metric unit (the `normal-type`); using
 * the first note's written value breaks mixed-duration tuplets.
 */
function finalizeTuplet(acc: TupletAccumulator): MnxTuplet {
  let innerMultiple = acc.actualNotes;
  let outerMultiple = acc.normalNotes;

  const unit = baseToFraction(acc.normalType);
  const total = writtenContentBeats(acc.events);
  if (unit && total && acc.actualNotes > 0 && unit.n > 0) {
    // units = total / unit, exact when the content tiles the metric unit.
    const unitsN = total.n * unit.d;
    const unitsD = total.d * unit.n;
    if (unitsD !== 0 && unitsN % unitsD === 0) {
      const units = unitsN / unitsD;
      if (units > 0 && (units * acc.normalNotes) % acc.actualNotes === 0) {
        innerMultiple = units;
        outerMultiple = (units * acc.normalNotes) / acc.actualNotes;
      }
    }
  }

  const tuplet: MnxTuplet = {
    type: "tuplet",
    inner: { duration: { base: acc.normalType }, multiple: innerMultiple },
    outer: { duration: { base: acc.normalType }, multiple: outerMultiple },
    content: acc.events,
  };
  if (acc.bracket === true) tuplet.bracket = "yes";
  else if (acc.bracket === false) tuplet.bracket = "no";
  if (acc.showNumber) tuplet.showNumber = acc.showNumber;
  if (acc.showValue) tuplet.showValue = acc.showValue;
  return tuplet;
}

/** Accumulates the events of a two-note (multi-note) tremolo between its
 *  MusicXML `<tremolo type="start">` and `<tremolo type="stop">` boundaries. */
interface TremoloAccumulator {
  marks: number;
  events: MnxEvent[];
  /** Metric duration of each event (from `<duration>`), in whole-note units. */
  perNote: Fraction[];
}

/** Read a multi-note tremolo boundary (`start`/`stop`) and its slash count from
 *  a `<note>` element's ornaments, scanning across all `<notations>` blocks.
 *  Single-note tremolos (`type="single"`) are handled as event markings and
 *  return undefined here. */
function readMultiTremolo(noteEl: Element): { action: "start" | "stop"; marks: number } | undefined {
  for (const orn of notationChildren(noteEl, "ornaments")) {
    for (const t of childElements(orn)) {
      if (t.tagName !== "tremolo") continue;
      const type = t.getAttribute("type");
      if (type === "start" || type === "stop") {
        return { action: type, marks: parseInt(t.textContent ?? "3", 10) };
      }
    }
  }
  return undefined;
}

/**
 * Build the MNX multi-note tremolo from an accumulator.
 *
 * The two events keep their written value (from `<type>`), but the container's
 * `outer` carries the total metric footprint. MusicXML encodes each tremolo
 * note's metric duration in `<duration>` (half the written value for a
 * two-note tremolo), so `outer = perNote × count`. The engine uses `outer` for
 * spacing and ignores the inner events' summed durations.
 */
function finalizeTremolo(acc: TremoloAccumulator): MnxMultiNoteTremolo {
  const count = acc.events.length;
  const total = acc.perNote.reduce((sum, f) => sum.add(f), Fraction.ZERO);
  const per = count > 0 ? new Fraction(total.n, total.d * count) : total;
  // Express `outer` as perNote × count when perNote is an exact note value;
  // otherwise fall back to the total as a single unit.
  const perBase = fractionToBase(per);
  const outer = perBase
    ? { duration: { base: perBase }, multiple: count }
    : { duration: { base: fractionToBase(total) ?? "quarter" }, multiple: 1 };
  return {
    type: "tremolo",
    content: acc.events,
    marks: acc.marks,
    outer,
  };
}

// eslint-disable-next-line max-lines-per-function, max-statements, complexity, max-params -- core MusicXML→MNX conversion loop; splits would fragment the sequential state machine (chord/grace/tuplet/beam tracking) and the positional params mirror the part-walker's per-measure state
export function processMeasureNotes(
  measureEl: Element,
  divisions: number,
  ids: IdGenerator,
  openSlurs: Map<string, SlurState>,
  tieIds: Map<string, MnxTie>,
  measureId: string,
  _globalMeasureIndex: number,
  _totalMeasures: number,
  vendorExt: boolean,
  transpose?: TransposeInterval,
  flags: ConvertFlags = {},
): MeasureResult {
  const voices = new Map<string, MnxSequenceContent[]>();
  const voiceStaves = new Map<string, number>();
  const clefs: MnxPositionedClef[] = [];
  const dynamics: MnxDynamic[] = [];
  const ottavaEvents: OttavaEvent[] = [];
  const beamGroups: MnxBeam[] = [];
  const rehearsals: MeasureResult["rehearsals"] = [];
  const expressions: MeasureResult["expressions"] = [];
  const hairpinEvents: MeasureResult["hairpinEvents"] = [];
  const pedalEvents: MeasureResult["pedalEvents"] = [];

  const cumulative = new Map<string, Fraction>();
  let currentPos = Fraction.ZERO;

  // Furthest written-content position per voice. A `<forward>` that merely
  // repositions the cursor over already-written notes (the backup+forward
  // idiom MusicXML uses to attach a `<direction>` at a specific offset) must
  // NOT emit a `space`, or the measure overflows. We only materialize the
  // portion of a forward that lies beyond this high-water mark.
  const voiceEnd = new Map<string, Fraction>();

  // Slur end IDs: maps slur number to the ID the stop event should have
  const pendingSlurEndIds = new Map<string, string>();

  // Beam tracking: map voice → list of {beamLevel, eventIds}
  const activeBeams = new Map<string, { eventIds: string[]; level: number }[]>();

  // Tuplet tracking per voice
  const activeTuplets = new Map<string, TupletAccumulator>();

  // Multi-note (two-note) tremolo tracking per voice
  const activeTremolos = new Map<string, TremoloAccumulator>();

  const getVoice = (key: string): MnxSequenceContent[] => {
    if (!voices.has(key)) voices.set(key, []);
    return voices.get(key)!;
  };

  const getCumulative = (key: string): Fraction => {
    return cumulative.get(key) ?? Fraction.ZERO;
  };

  const children = childElements(measureEl);
  let i = 0;

  while (i < children.length) {
    const el = children[i]!;

    if (el.tagName === "note") {
      const voiceEl = findChild(el, "voice");
      const voiceNum = voiceEl?.textContent ?? "1";
      const isChord = findChild(el, "chord") !== null;
      const isGrace = findChild(el, "grace") !== null;
      const isRest = findChild(el, "rest") !== null;
      const staffEl = findChild(el, "staff");
      const staffNum = staffEl ? parseInt(staffEl.textContent ?? "1", 10) : 1;

      // Track voice → staff mapping
      if (!voiceStaves.has(voiceNum)) voiceStaves.set(voiceNum, staffNum);

      if (isChord) {
        // Add to the last event in this voice
        const voiceEvents = getVoice(voiceNum);
        // Find last event (might be inside a tuplet)
        const lastContent = voiceEvents[voiceEvents.length - 1];
        let lastEvent: MnxEvent | undefined;
        if (lastContent && !("type" in lastContent && lastContent.type)) {
          lastEvent = lastContent as MnxEvent;
        } else if (lastContent && "type" in lastContent && lastContent.type === "tuplet") {
          // The principal note carried the tuplet's `<tuplet type="stop">`, so
          // the tuplet was already finalized and pushed to the voice before
          // this `<chord/>` note arrived. Reach into the finalized tuplet's
          // content and fold the chord note into its last event, otherwise the
          // bottom note of the final tuplet event is silently dropped.
          const tupletContent = (lastContent as MnxTuplet).content;
          const last = tupletContent[tupletContent.length - 1];
          if (last && !("type" in last && (last as MnxGraceEvent | MnxTuplet | MnxSpace).type)) {
            lastEvent = last as MnxEvent;
          }
        }
        const tupletAcc = activeTuplets.get(voiceNum);
        if (tupletAcc && tupletAcc.events.length > 0) {
          const last = tupletAcc.events[tupletAcc.events.length - 1];
          if (last && !("type" in last && (last as MnxGraceEvent | MnxTuplet | MnxSpace).type)) {
            lastEvent = last as MnxEvent;
          }
        }
        const tremAcc = activeTremolos.get(voiceNum);
        if (tremAcc && tremAcc.events.length > 0) {
          lastEvent = tremAcc.events[tremAcc.events.length - 1];
        }

        if (lastEvent?.notes) {
          const noteObj = buildNote(el, voiceNum, tieIds, ids, transpose);
          lastEvent.notes.push(noteObj);
        }
        i++;
        continue;
      }

      if (isGrace) {
        // Collect consecutive grace notes
        const graceNotes: MnxEvent[] = [];
        let hasSlash = false;
        while (i < children.length && children[i]!.tagName === "note" && findChild(children[i]!, "grace") !== null) {
          const gel = children[i]!;
          const graceEl = findChild(gel, "grace");
          if (graceEl?.getAttribute("slash") === "yes") hasSlash = true;

          // A grace note carrying <chord/> is an additional voice member of the
          // preceding grace event, not a new event. Fold its pitch into the
          // last grace event's notes so a 2-note grace chord stays one event.
          if (findChild(gel, "chord") !== null) {
            const lastGrace = graceNotes[graceNotes.length - 1];
            if (lastGrace?.notes) {
              lastGrace.notes.push(buildNote(gel, voiceNum, tieIds, ids, transpose));
            }
            i++;
            continue;
          }

          const gnoteType = findChild(gel, "type");
          const gdots = findChildren(gel, "dot").length;
          const gbase = gnoteType ? (TYPE_MAP[gnoteType.textContent ?? ""] ?? "eighth") : "eighth";
          const gpitch = findChild(gel, "pitch");
          const gdur: MnxDuration = gdots > 0 ? { base: gbase, dots: gdots } : { base: gbase };

          // Grace events participate in slurs exactly like principal events: a
          // slur may start on a grace note (the common acciaccatura case) or
          // stop on one. Reuse a pending slur-end target ID when this grace
          // event is a slur stop, otherwise mint a fresh ID so the event can
          // be referenced as a slur endpoint.
          const graceId = resolveSlurStopId(gel, openSlurs) ?? ids.next("ev");

          const graceEvent: MnxEvent = { duration: gdur, id: graceId };
          if (gpitch) {
            const noteObj = buildNote(gel, voiceNum, tieIds, ids, transpose);
            graceEvent.notes = [noteObj];
          } else {
            graceEvent.rest = {};
          }

          // Markings on grace notes
          const graceMarkings = extractMarkings(gel, vendorExt);
          if (graceMarkings) graceEvent.markings = graceMarkings;
          const graceFermata = extractFermata(gel);
          if (graceFermata) graceEvent.fermata = graceFermata;

          // Slurs anchored on the grace note.
          const graceNoteId = graceEvent.notes?.[0]?.id ?? graceEvent.notes?.[0]?.ties?.[0]?.target;
          const graceSlurs = extractSlurs(gel, graceId, graceNoteId, openSlurs, ids, pendingSlurEndIds);
          if (graceSlurs) graceEvent.slurs = graceSlurs;

          graceNotes.push(graceEvent);
          i++;
        }
        if (graceNotes.length > 0) {
          const grace: MnxGraceEvent = { type: "grace", content: graceNotes };
          if (hasSlash) grace.slash = true;

          const tupletAcc = activeTuplets.get(voiceNum);
          if (tupletAcc) {
            tupletAcc.events.push(grace);
          } else {
            getVoice(voiceNum).push(grace);
          }
        }
        continue;
      }

      // Leading gap fill. A voice can begin mid-measure purely by cursor
      // position: a `<backup>` rewinds the shared cursor, then the new voice's
      // first note is written directly with no preceding rest or `<forward>`
      // (e.g. the Rhapsody left-hand bar where voice 5 enters on beat 3 after a
      // backup of a half note). Without a leading `space`, the voice would
      // start at the measure's beginning. Materialize the gap between the
      // voice's already-written content and the current cursor as a `space`.
      // Skipped while a tuplet/tremolo is open for the voice — those manage
      // their own internal spacing, and a fresh tuplet hasn't opened yet here.
      if (!activeTuplets.has(voiceNum) && !activeTremolos.has(voiceNum)) {
        const written = voiceEnd.get(voiceNum) ?? Fraction.ZERO;
        const gap = currentPos.subtract(written);
        if (gap.n > 0) {
          getVoice(voiceNum).push({ type: "space", duration: [gap.n, gap.d] });
          voiceEnd.set(voiceNum, currentPos);
        }
      }

      // Regular note or rest
      const { durObj, advance } = computeNoteDuration(el, divisions);

      // Check for tuplet start/stop
      let tupletStart = false;
      let tupletStop = false;
      let tupletBracket: boolean | undefined;
      let tupletShowNumber: TupletAccumulator["showNumber"];
      let tupletShowValue: TupletAccumulator["showValue"];

      for (const tupletEl of notationChildren(el, "tuplet")) {
        const tupletType = tupletEl.getAttribute("type");
        if (tupletType === "start") {
          tupletStart = true;
          tupletBracket = tupletEl.getAttribute("bracket") === "yes";
          // MusicXML <tuplet show-number="none|actual|both"> → MNX showNumber.
          // "actual" matches MNX "inner". Default in MusicXML is `actual`.
          const showNum = tupletEl.getAttribute("show-number");
          if (showNum === "none") tupletShowNumber = "noNumber";
          else if (showNum === "actual") tupletShowNumber = "inner";
          else if (showNum === "both") tupletShowNumber = "both";
          // MusicXML <tuplet show-type="none|actual|both"> → MNX showValue.
          const showType = tupletEl.getAttribute("show-type");
          if (showType === "none") tupletShowValue = "noValue";
          else if (showType === "actual") tupletShowValue = "inner";
          else if (showType === "both") tupletShowValue = "both";
        } else if (tupletType === "stop") {
          tupletStop = true;
        }
      }

      // Time modification for tuplet ratio
      const timeMod = findChild(el, "time-modification");
      let actualNotes = 0;
      let normalNotes = 0;
      let normalType = "";
      if (timeMod) {
        actualNotes = parseInt(childText(timeMod, "actual-notes") ?? "3", 10);
        normalNotes = parseInt(childText(timeMod, "normal-notes") ?? "2", 10);
        const normalTypeEl = childText(timeMod, "normal-type");
        normalType = normalTypeEl ? (TYPE_MAP[normalTypeEl] ?? normalTypeEl) : durObj.base;
      }

      if (tupletStart && timeMod) {
        // Start a new tuplet accumulator. The metric unit (MusicXML
        // `normal-type`) and unit counts are resolved at finalize time from the
        // accumulated content — see finalizeTuplet.
        activeTuplets.set(voiceNum, {
          actualNotes,
          normalNotes,
          normalType,
          events: [],
          bracket: tupletBracket,
          showNumber: tupletShowNumber,
          showValue: tupletShowValue,
        });
      }

      // Multi-note (two-note) tremolo boundary. On `start`, open an accumulator
      // so subsequent events (and chord notes) collect into the tremolo
      // container instead of the bare voice; on `stop`, finalize below.
      const multiTremolo = readMultiTremolo(el);
      if (multiTremolo?.action === "start") {
        activeTremolos.set(voiceNum, { marks: multiTremolo.marks, events: [], perNote: [] });
      }

      // If this event is a slur endpoint, use the target ID; otherwise generate a new ID.
      // Check slur stops BEFORE extracting slurs (a note can be both a stop and start).
      const eventId = resolveSlurStopId(el, openSlurs) ?? ids.next("ev");

      const event: MnxEvent = { duration: durObj, id: eventId };

      if (isRest) {
        event.rest = {};
      } else {
        const noteObj = buildNote(el, voiceNum, tieIds, ids, transpose);
        event.notes = [noteObj];
      }

      // Markings (articulations, ornaments)
      const markings = extractMarkings(el, vendorExt);
      if (markings) event.markings = markings;

      // Native MNX fermata (event-level since v15).
      const fermata = extractFermata(el);
      if (fermata) event.fermata = fermata;

      // Staff assignment on event. The sequence carries the voice's *home*
      // staff (its first note's staff); an event only needs an explicit
      // `staff` when it crosses to a different one. The old `staffNum > 1`
      // test silently dropped the override for notes that cross *down* to
      // staff 1 in a voice whose home staff is 2+ (common in piano writing),
      // leaving those notes stranded on the home staff.
      const homeStaff = voiceStaves.get(voiceNum) ?? 1;
      if (staffNum !== homeStaff) event.staff = staffNum;

      // Stem direction override (`<stem>up|down</stem>`). MNX spec only
      // accepts `up | down`; `<stem>none</stem>` (stemless) and
      // `<stem>double</stem>` are dropped silently for now. When
      // `discardStemDirections` is set the override is dropped entirely so the
      // engine computes stem orientation from its voice/pitch convention.
      const stemEl = flags.discardStemDirections ? null : findChild(el, "stem");
      if (stemEl) {
        const stemTxt = (stemEl.textContent ?? "").trim();
        if (stemTxt === "up" || stemTxt === "down") {
          event.stemDirection = stemTxt;
        }
      }

      // Slurs
      const noteId = event.notes?.[0]?.id ?? event.notes?.[0]?.ties?.[0]?.target;
      const slurs = extractSlurs(el, eventId, noteId, openSlurs, ids, pendingSlurEndIds);
      if (slurs) event.slurs = slurs;

      // Lyrics
      const lyricLines = extractLyrics(el);
      if (lyricLines) {
        event.lyrics = { lines: lyricLines };
      }

      // Beam tracking. Skipped while a multi-note tremolo is open for this
      // voice — the tremolo slashes stand in for the connecting beam, so the
      // two notes must not also form a regular beam group.
      const beamEls = activeTremolos.has(voiceNum) ? [] : findChildren(el, "beam");
      for (const beamEl of beamEls) {
        const beamNum = parseInt(beamEl.getAttribute("number") ?? "1", 10);
        const beamValue = beamEl.textContent ?? "";

        if (beamValue === "begin") {
          if (!activeBeams.has(voiceNum)) activeBeams.set(voiceNum, []);
          const voiceBeams = activeBeams.get(voiceNum)!;
          // Start a new beam at this level
          voiceBeams.push({ eventIds: [eventId], level: beamNum });
        } else if (beamValue === "continue" || beamValue === "end") {
          const voiceBeams = activeBeams.get(voiceNum);
          if (voiceBeams) {
            const beam = voiceBeams.find((b) => b.level === beamNum);
            if (beam) beam.eventIds.push(eventId);

            if (beamValue === "end" && beamNum === 1) {
              // Primary beam ended — emit beam group
              const primaryBeam = voiceBeams.find((b) => b.level === 1);
              if (primaryBeam && primaryBeam.eventIds.length >= 2) {
                beamGroups.push({ events: [...primaryBeam.eventIds] });
              }
              activeBeams.delete(voiceNum);
            }
          }
        }
      }

      // Add event to tremolo, tuplet, or voice (tremolo is the innermost
      // container; on stop it finalizes into whatever encloses it).
      const tremAcc = activeTremolos.get(voiceNum);
      const tupletAcc = activeTuplets.get(voiceNum);
      if (tremAcc) {
        tremAcc.events.push(event);
        tremAcc.perNote.push(advance);
        if (multiTremolo?.action === "stop") {
          const trem = finalizeTremolo(tremAcc);
          if (tupletAcc) tupletAcc.events.push(trem);
          else getVoice(voiceNum).push(trem);
          activeTremolos.delete(voiceNum);
        }
      } else if (tupletAcc) {
        tupletAcc.events.push(event);

        if (tupletStop) {
          getVoice(voiceNum).push(finalizeTuplet(tupletAcc));
          activeTuplets.delete(voiceNum);
        }
      } else {
        getVoice(voiceNum).push(event);
      }

      // Advance position
      if (advance.n !== 0) {
        cumulative.set(voiceNum, getCumulative(voiceNum).add(advance));
        currentPos = currentPos.add(advance);
        voiceEnd.set(voiceNum, fracMax(voiceEnd.get(voiceNum) ?? Fraction.ZERO, currentPos));
      }
    } else if (el.tagName === "forward") {
      const durEl = findChild(el, "duration");
      const voiceEl = findChild(el, "voice");
      const voiceNum = voiceEl?.textContent ?? "1";
      if (durEl) {
        const adv = new Fraction(parseInt(durEl.textContent ?? "0", 10), divisions * 4);
        if (adv.n > 0) {
          // A <forward> advances the shared cursor. Only the slice beyond the
          // voice's already-written content becomes a real `space`; a
          // backup+forward pair used purely to position a <direction> moves
          // over existing notes and must emit nothing (otherwise the measure
          // overflows — e.g. the Rhapsody clarinet bar where p / crescendo
          // are attached mid-tuplet, doubling the bar length).
          const written = voiceEnd.get(voiceNum) ?? Fraction.ZERO;
          const endPos = currentPos.add(adv);
          const gap = endPos.subtract(fracMax(currentPos, written));
          if (gap.n > 0) {
            const staffEl = findChild(el, "staff");
            if (staffEl && !voiceStaves.has(voiceNum)) {
              voiceStaves.set(voiceNum, parseInt(staffEl.textContent ?? "1", 10));
            }
            // A forward inside an open tuplet keeps its space within the tuplet
            // so the inner content stays coherent.
            const space: MnxSpace = { type: "space", duration: [gap.n, gap.d] };
            const tAcc = activeTuplets.get(voiceNum);
            if (tAcc) tAcc.events.push(space);
            else getVoice(voiceNum).push(space);
            voiceEnd.set(voiceNum, endPos);
          }
        }
        cumulative.set(voiceNum, getCumulative(voiceNum).add(adv));
        currentPos = currentPos.add(adv);
      }
    } else if (el.tagName === "backup") {
      const durEl = findChild(el, "duration");
      if (durEl) {
        const backupDur = new Fraction(parseInt(durEl.textContent ?? "0", 10), divisions * 4);
        currentPos = currentPos.subtract(backupDur);
        if (currentPos.isNegative()) currentPos = Fraction.ZERO;
      }
    } else if (el.tagName === "direction") {
      const staffEl = findChild(el, "staff");
      const dirStaff = staffEl ? parseInt(staffEl.textContent ?? "1", 10) : undefined;
      const directionVoice = findChild(el, "voice")?.textContent?.trim();
      const dirVoice = directionVoice ? `v${directionVoice}` : undefined;
      // A single `<direction>` can carry multiple `<direction-type>` children;
      // some exporters emit the identical `<words>` twice (e.g. "pizz." in both
      // direction-types), which would otherwise produce duplicate staff text.
      // Track the word texts already emitted for this direction to dedupe them.
      const seenWords = new Set<string>();

      for (const dt of findChildren(el, "direction-type")) {
        // Dynamics
        const dyn = findChild(dt, "dynamics");
        if (dyn) {
          const firstChild = childElements(dyn)[0];
          if (firstChild) {
            const dynObj: MnxDynamic = createDynamicGroup(firstChild.tagName, makePosition(currentPos));
            if (dirStaff && dirStaff > 1) dynObj.staff = dirStaff;
            if (dirVoice) dynObj.voice = dirVoice;
            dynamics.push(dynObj);
          }
        }

        // Ottava (octave-shift) — emit boundary events; the part-level walker
        // pairs a `start` with its `stop` even across measures.
        const octaveShift = findChild(dt, "octave-shift");
        if (octaveShift) {
          const shiftType = octaveShift.getAttribute("type");
          const size = parseInt(octaveShift.getAttribute("size") ?? "8", 10);
          if (shiftType === "up" || shiftType === "down") {
            // MusicXML octave-shift: "down" means sounding pitch is below written
            // pitch → 8va (play higher than written). "up" → 8vb (play lower).
            let ottavaValue: number;
            if (size === 8) ottavaValue = shiftType === "down" ? 1 : -1;
            else if (size === 15) ottavaValue = shiftType === "down" ? 2 : -2;
            else ottavaValue = shiftType === "down" ? 1 : -1;

            ottavaEvents.push({
              action: "start",
              value: ottavaValue,
              position: makePosition(currentPos),
              staff: dirStaff,
            });
          } else if (shiftType === "stop") {
            ottavaEvents.push({
              action: "stop",
              position: makePosition(currentPos),
              staff: dirStaff,
            });
          }
          // "continue" carries no boundary.
        }

        // Rehearsal marks
        const rehearsal = findChild(dt, "rehearsal");
        if (rehearsal) {
          const rehearsalText = (rehearsal.textContent ?? "").trim();
          if (rehearsalText) {
            rehearsals.push({
              text: rehearsalText,
              position: makePosition(currentPos),
            });
          }
        }

        // Words (text expressions)
        const wordsEl = findChild(dt, "words");
        if (wordsEl && !dyn) {
          // Only capture standalone words, not words that are part of dynamics.
          // A `directive="yes"` direction is a tempo/expression directive (e.g.
          // "Molto moderato") whose text is imported onto the global tempo in
          // globalMeasures; skip it here so the same text isn't also emitted as
          // a staff text expression (double import).
          const text = wordsEl.textContent?.trim() ?? "";
          if (text && el.getAttribute("directive") !== "yes" && !seenWords.has(text)) {
            seenWords.add(text);
            const placementAttr = el.getAttribute("placement");
            const expr: MeasureResult["expressions"][number] = { text, position: makePosition(currentPos) };
            if (placementAttr === "above" || placementAttr === "below") expr.placement = placementAttr;
            // Grand-staff parts authored on staff 2 carry `<staff>2</staff>`;
            // an unspecified staff defaults to staff 1, so only record an
            // explicit override (matches the dynamics convention).
            if (dirStaff && dirStaff > 1) expr.staff = dirStaff;
            expressions.push(expr);
          }
        }

        // Pedal — MusicXML pedal boundaries paired into spans at the part level.
        const pedalEl = findChild(dt, "pedal");
        if (pedalEl) {
          const pedalType = pedalEl.getAttribute("type") ?? "start";
          const position = makePosition(currentPos);
          if (pedalType === "start") {
            pedalEvents.push({ action: "start", pedalType: "sustain", position, staff: dirStaff });
          } else if (pedalType === "sostenuto") {
            pedalEvents.push({ action: "start", pedalType: "sostenuto", position, staff: dirStaff });
          } else if (pedalType === "stop" || pedalType === "discontinue") {
            pedalEvents.push({ action: "stop", position, staff: dirStaff });
          } else if (pedalType === "change") {
            // A pedal change is a release immediately followed by a re-engage.
            pedalEvents.push({ action: "stop", position, staff: dirStaff });
            pedalEvents.push({ action: "start", pedalType: "sustain", position, staff: dirStaff });
          }
          // "continue" carries no boundary.
        }

        // Wedge (hairpin / crescendo / diminuendo) — paired into spans at the
        // part level (each needs a start position and an end position).
        const wedgeEl = findChild(dt, "wedge");
        if (wedgeEl) {
          const wedgeType = wedgeEl.getAttribute("type") ?? "crescendo";
          const position = makePosition(currentPos);
          if (wedgeType === "crescendo") {
            hairpinEvents.push({
              action: "start",
              hairpinType: "crescendo",
              position,
              staff: dirStaff,
              voice: dirVoice,
            });
          } else if (wedgeType === "diminuendo") {
            hairpinEvents.push({
              action: "start",
              hairpinType: "decrescendo",
              position,
              staff: dirStaff,
              voice: dirVoice,
            });
          } else if (wedgeType === "stop") {
            hairpinEvents.push({ action: "stop", position, staff: dirStaff, voice: dirVoice });
          }
          // "continue" carries no boundary.
        }
      }
    } else if (el.tagName === "attributes") {
      // Handle mid-measure attribute changes (divisions)
      const divEl = findChild(el, "divisions");
      if (divEl) {
        divisions = parseInt(divEl.textContent ?? "4", 10);
      }
      // Clefs may appear in the measure-initial `<attributes>` (currentPos == 0,
      // emitted unpositioned) or in a later `<attributes>` block mid-measure
      // (a clef change — common on piano staves), positioned at the current
      // cursor. Walking the children in order with `currentPos` gives the exact
      // rhythmic offset for each change.
      for (const clefEl of findChildren(el, "clef")) {
        const position = currentPos.n === 0 ? undefined : makePosition(currentPos);
        clefs.push(clefFromElement(clefEl, position));
      }
    }

    i++;
  }

  // Flush any unclosed tuplets
  for (const [voiceNum, tupletAcc] of activeTuplets) {
    if (tupletAcc.events.length > 0) {
      getVoice(voiceNum).push(finalizeTuplet(tupletAcc));
    }
  }

  // Divisi parts emit one `<direction>` per voice/layer, so an identical
  // dynamic or text expression can be captured several times at the same
  // position (and staff). Collapse exact duplicates so they don't render
  // overprinted on top of each other.
  const dynSeen = new Set<string>();
  const dedupedDynamics = dynamics.filter((d) => {
    const key = `${d.position.fraction[0]}/${d.position.fraction[1]}|${d.value}|${d.staff ?? 1}|${d.voice ?? ""}`;
    if (dynSeen.has(key)) return false;
    dynSeen.add(key);
    return true;
  });
  const exprSeen = new Set<string>();
  const dedupedExpressions = expressions.filter((e) => {
    const key = `${e.position.fraction[0]}/${e.position.fraction[1]}|${e.text}|${e.placement ?? ""}`;
    if (exprSeen.has(key)) return false;
    exprSeen.add(key);
    return true;
  });

  return {
    voices,
    voiceStaves,
    clefs,
    dynamics: dedupedDynamics,
    ottavaEvents,
    beamGroups,
    rehearsals,
    expressions: dedupedExpressions,
    hairpinEvents,
    pedalEvents,
  };
}
