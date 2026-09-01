import { childText, findChild, findChildren } from "../xmlHelpers";
import type {
  MnxGlobalMeasure,
  MnxGraceEvent,
  MnxDynamic,
  MnxOttava,
  MnxPart,
  MnxPartMeasure,
  MnxRhythmicPosition,
  MnxSequenceContent,
  MnxSpace,
  MnxEvent,
  MnxTie,
  MnxTuplet,
  PartInfo,
} from "../types";
import { IdGenerator } from "./idGenerator";
import { type ConvertFlags, type OttavaEvent, processMeasureNotes } from "./measureNotes";
import { type GlissandoState, type SlurState } from "./notes";
import { type TransposeInterval } from "./pitchDuration";

// Parse `<transpose>` from a part's first measure.
//
// MusicXML stores WRITTEN pitches and `<transpose>` defines the
// (written → sounding) interval. MNX stores SOUNDING pitches and
// `part.transposition.interval` is the (sounding → written) interval — i.e.
// the negation. We return both the original MusicXML interval (for transposing
// each pitch written → sounding) and the inverted MNX `transposition` object.
function parsePartTransposition(partEl: Element): {
  partTranspose?: TransposeInterval;
  transposition?: MnxPart["transposition"];
} {
  const m1 = findChild(partEl, "measure");
  const a = m1 ? findChild(m1, "attributes") : null;
  const transpose = a ? findChild(a, "transpose") : null;
  if (!transpose) return {};
  const chrom = childText(transpose, "chromatic");
  if (!chrom) return {};
  const halfSteps = parseInt(chrom, 10);
  const dia = childText(transpose, "diatonic");
  const oct = childText(transpose, "octave-change");
  const staffDistance = dia ? parseInt(dia, 10) : 0;
  const octaveChange = oct ? parseInt(oct, 10) : 0;
  if (halfSteps === 0 && staffDistance === 0 && octaveChange === 0) return {};
  // Pure-octave transposers (piccolo +8va, double bass / contrabass -8va,
  // glockenspiel, etc.) are conventionally notated at written pitch even in a
  // concert-pitch score — writing them at sounding pitch would bury them in
  // ledger lines. Flag them so the engine keeps them written regardless of the
  // score's `useWritten` mode.
  const isPureOctave = halfSteps === 0 && staffDistance === 0 && octaveChange !== 0;
  const transposition: MnxPart["transposition"] = {
    interval: {
      halfSteps: -(halfSteps + 12 * octaveChange),
      staffDistance: -(staffDistance + 7 * octaveChange),
    },
  };
  if (isPureOctave) transposition.prefersWrittenPitches = true;
  return {
    partTranspose: { halfSteps, staffDistance, octaveChange },
    transposition,
  };
}

// Highest `<staff>` number referenced by any note across the whole part.
// Notes default to staff 1 when no `<staff>` child is present.
function maxStaffReferenced(partEl: Element): number {
  let max = 1;
  for (const measureEl of findChildren(partEl, "measure")) {
    for (const noteEl of findChildren(measureEl, "note")) {
      const s = childText(noteEl, "staff");
      if (s) {
        const n = parseInt(s, 10);
        if (n > max) max = n;
      }
    }
  }
  return max;
}

// Resolve the effective staff count from a `<staves>` declaration, clamping to
// the staves actually referenced by notes so a declared-but-empty ossia staff
// (common with string divisi) is pruned. Returns undefined for a single staff.
function resolveStaves(declaredText: string | null | undefined, partEl: Element): number | undefined {
  if (declaredText == null) return undefined;
  const declared = parseInt(declaredText, 10);
  if (declared <= 1) return undefined;
  const staves = Math.max(1, Math.min(declared, maxStaffReferenced(partEl)));
  return staves > 1 ? staves : undefined;
}

// A part-level octave-shift cursor: the open `start` boundary awaiting its
// `stop`, remembered across measures so a shift can span them.
type OpenOttava = { mi: number; position: MnxRhythmicPosition; value: number; staff?: number };

// Fold one measure's octave-shift boundary events into completed `ottava`
// spans, buffered against their START measure. A shift may begin in one measure
// and end in a later one, so the open boundary is threaded through (returned)
// rather than reset per measure. Returns the still-open boundary (or null).
function pairOttavaEvents(
  events: OttavaEvent[],
  mi: number,
  measureId: string,
  open: OpenOttava | null,
  byMeasure: Map<number, MnxOttava[]>,
): OpenOttava | null {
  let current = open;
  for (const ev of events) {
    if (ev.action === "start" && ev.value !== undefined) {
      current = { mi, position: ev.position, value: ev.value, staff: ev.staff };
    } else if (ev.action === "stop" && current) {
      const ottava: MnxOttava = {
        value: current.value,
        position: current.position,
        end: { measure: measureId, position: ev.position },
      };
      if (current.staff !== undefined) ottava.staff = current.staff;
      const arr = byMeasure.get(current.mi);
      if (arr) arr.push(ottava);
      else byMeasure.set(current.mi, [ottava]);
      current = null;
    }
  }
  return current;
}

// Write buffered octave-shift spans onto their START measures. `ottavas` is a
// first-class MNX field (not a vendor extension), so this is unconditional. Any
// shift still open at the end of the part is dropped (it has no valid end).
function writeOttavaSpans(measures: MnxPartMeasure[], byMeasure: Map<number, MnxOttava[]>): void {
  for (let mi = 0; mi < measures.length; mi++) {
    const ottavas = byMeasure.get(mi);
    if (ottavas && ottavas.length > 0) measures[mi]!.ottavas = ottavas;
  }
}

// eslint-disable-next-line max-statements, complexity, max-lines-per-function -- per-part conversion orchestrator wiring transposition, staves, sequences, and cross-measure spans; splitting fragments the stateful measure walk
export function buildParts(
  root: Element,
  partsInfo: PartInfo[],
  globalMeasures: MnxGlobalMeasure[],
  ids: IdGenerator,
  vendorExt: boolean,
  flags: ConvertFlags = {},
): { mnxParts: MnxPart[]; lyricLineIds: Set<string> } {
  const mnxParts: MnxPart[] = [];
  const lyricLineIds = new Set<string>();
  const openSlurs = new Map<string, SlurState>();
  const openGlissandos = new Map<string, GlissandoState>();
  // Tie pairing persists across measures so ties spanning a barline resolve.
  const tieIds = new Map<string, MnxTie>();

  for (const [partIdx, partEl] of findChildren(root, "part").entries()) {
    const pid = partEl.getAttribute("id") ?? `P${partIdx + 1}`;
    const info: PartInfo = partsInfo[partIdx] ?? {
      id: pid,
      name: pid,
      abbreviation: "",
      staves: 1,
    };

    const mnxPart: MnxPart = { id: info.id, measures: [] };
    if (info.name) mnxPart.name = info.name;
    if (info.abbreviation) mnxPart.shortName = info.abbreviation;

    const { partTranspose, transposition } = parsePartTransposition(partEl);
    if (transposition) mnxPart.transposition = transposition;

    // Multi-staff detection from the first measure's attributes.
    const m1Attrs = (() => {
      const m1 = findChild(partEl, "measure");
      return m1 ? findChild(m1, "attributes") : null;
    })();
    const m1Staves = m1Attrs ? findChild(m1Attrs, "staves") : null;
    const m1StaffCount = resolveStaves(m1Staves?.textContent, partEl);
    if (m1StaffCount) {
      mnxPart.staves = m1StaffCount;
      info.staves = m1StaffCount;
    }

    let divisions = 4;
    openSlurs.clear();
    openGlissandos.clear();
    tieIds.clear();

    const partMeasureEls = findChildren(partEl, "measure");

    // Cross-measure spanner pairing. Hairpins and pedals are MusicXML
    // start/stop boundaries; MNX wants a single span object (with `position`
    // and `end`) attached to the measure where the span STARTS. We buffer the
    // completed spans per measure index and write them after the whole part is
    // walked.
    type Pos = MnxRhythmicPosition;
    type Span = { type: string; position: Pos; end: { measure: string; position: Pos }; staff?: number };
    const hairpinsByMeasure = new Map<number, MnxDynamic[]>();
    const pedalsByMeasure = new Map<number, Span[]>();
    const ottavasByMeasure = new Map<number, MnxOttava[]>();
    const exprByMeasure = new Map<
      number,
      { text: string; position: Pos; placement?: "above" | "below"; staff?: number }[]
    >();
    let openHairpin: { mi: number; position: Pos; type: string; staff?: number; voice?: string } | null = null;
    let openPedal: { mi: number; position: Pos; type: string; staff?: number } | null = null;
    let openOttava: OpenOttava | null = null;
    const pushSpan = (map: Map<number, Span[]>, mi: number, span: Span): void => {
      const arr = map.get(mi);
      if (arr) arr.push(span);
      else map.set(mi, [span]);
    };

    for (let mi = 0; mi < partMeasureEls.length; mi++) {
      const measureEl = partMeasureEls[mi]!;
      const mnxMeasure: MnxPartMeasure = {};
      const measureId = globalMeasures[mi]?.id ?? `m${mi + 1}`;

      const attrs = findChild(measureEl, "attributes");
      if (attrs) {
        const divEl = findChild(attrs, "divisions");
        if (divEl) {
          divisions = parseInt(divEl.textContent ?? "4", 10);
        }

        // Multi-staff detection (can appear in later measures too).
        const stavesEl = findChild(attrs, "staves");
        const staffCount = resolveStaves(stavesEl?.textContent, partEl);
        if (staffCount) {
          mnxPart.staves = staffCount;
          info.staves = staffCount;
        }
      }

      // Clefs (including mid-measure changes) are collected by
      // processMeasureNotes, which walks the measure in document order and
      // positions each clef change at the cursor offset.

      const result = processMeasureNotes(
        measureEl,
        divisions,
        ids,
        openSlurs,
        openGlissandos,
        tieIds,
        measureId,
        mi,
        partMeasureEls.length,
        vendorExt,
        partTranspose,
        flags,
      );

      if (result.clefs.length > 0) {
        mnxMeasure.clefs = result.clefs;
      }

      if (result.dynamics.length > 0) {
        mnxMeasure.dynamics = result.dynamics;
      }

      if (result.beamGroups.length > 0) {
        mnxMeasure.beams = result.beamGroups;
      }

      if (result.nonArpeggios.length > 0) {
        mnxMeasure.nonArpeggios = result.nonArpeggios;
      }

      if (result.chordSymbols.length > 0) {
        mnxMeasure._x = { viritura: { chordSymbols: result.chordSymbols } };
      }

      // Pair octave-shift boundaries into spans. Unlike hairpins/pedals (vendor
      // extensions), `ottavas` is a first-class MNX field, so this runs
      // unconditionally. A shift may span measures, so the completed span is
      // buffered against its START measure and written after the part walk.
      openOttava = pairOttavaEvents(result.ottavaEvents, mi, measureId, openOttava, ottavasByMeasure);

      // Build sequences from voices
      const sequences = [];
      for (const voiceNum of Array.from(result.voices.keys()).sort()) {
        const events = result.voices.get(voiceNum)!;
        if (events.length > 0) {
          const seq: {
            content: typeof events;
            voice?: string;
            staff?: number;
          } = { content: events };

          // Assign voice name if multiple voices
          if (result.voices.size > 1) {
            seq.voice = `v${voiceNum}`;
          }

          // Staff assignment for multi-staff parts
          const staffNum = result.voiceStaves.get(voiceNum);
          if (staffNum) {
            seq.staff = staffNum;
          }

          sequences.push(seq);
        }
      }

      // Drop phantom voices that hold only `space` placeholders — leftovers
      // from the backup/forward cursor idiom (a voice positioned but never
      // given real notes). They render as empty voice slots. Only drop them
      // when at least one *real* voice survives, so a genuinely empty bar
      // (a `<forward>`-only measure) still keeps its space sequence and isn't
      // emitted bare.
      const isSpaceOnly = (seq: { content: MnxSequenceContent[] }): boolean =>
        seq.content.every((c) => "type" in c && c.type === "space");
      const realSequences = sequences.filter((s) => !isSpaceOnly(s));
      const finalSequences = realSequences.length > 0 ? realSequences : sequences;

      if (finalSequences.length > 0) {
        mnxMeasure.sequences = finalSequences;
      }

      // Collect lyric line IDs
      for (const seq of finalSequences) {
        for (const content of seq.content) {
          if (!("type" in content && (content as MnxGraceEvent | MnxTuplet | MnxSpace).type)) {
            const evt = content as MnxEvent;
            if (evt.lyrics?.lines) {
              // eslint-disable-next-line max-depth -- nested traversal of seq.content → event → lyrics.lines
              for (const lineId of Object.keys(evt.lyrics.lines)) {
                lyricLineIds.add(lineId);
              }
            }
          }
        }
      }

      // Hairpins are standard gradual dynamic groups. Pair their MusicXML
      // start/stop boundaries regardless of whether vendor extensions are enabled.
      for (const ev of result.hairpinEvents) {
        if (ev.action === "start") {
          openHairpin = {
            mi,
            position: ev.position,
            type: ev.hairpinType ?? "crescendo",
            staff: ev.staff,
            voice: ev.voice,
          };
        } else if (openHairpin) {
          const group: MnxDynamic = {
            id: ids.next("dyn"),
            type: "gradual",
            position: openHairpin.position,
            end: { measure: measureId, position: ev.position },
            wedgeType: openHairpin.type === "crescendo" ? "increasing" : "decreasing",
            ...(openHairpin.staff === undefined ? {} : { staff: openHairpin.staff }),
            ...(openHairpin.voice === undefined ? {} : { voice: openHairpin.voice }),
          };
          const groups = hairpinsByMeasure.get(openHairpin.mi);
          if (groups) groups.push(group);
          else hairpinsByMeasure.set(openHairpin.mi, [group]);
          openHairpin = null;
        }
      }

      // Vendor extension data. Text expressions are attached to their own
      // measure; pedals are start/stop spans paired across
      // measures and attached to the measure where they START. Rehearsal marks
      // belong on the GLOBAL measure, not the part measure.
      if (vendorExt) {
        if (result.expressions.length > 0) {
          exprByMeasure.set(mi, result.expressions);
        }

        // Rehearsal mark → global measure (first part to declare one wins).
        if (result.rehearsals.length > 0) {
          const gm = globalMeasures[mi] as unknown as Record<string, unknown> | undefined;
          if (gm) {
            const gx = (gm["_x"] ??= { viritura: {} }) as { viritura: Record<string, unknown> };
            if (gx.viritura["rehearsalMark"] === undefined) {
              gx.viritura["rehearsalMark"] = { text: result.rehearsals[0]!.text };
            }
          }
        }

        // Pair pedal boundaries into spans.
        for (const ev of result.pedalEvents) {
          if (ev.action === "start") {
            openPedal = { mi, position: ev.position, type: ev.pedalType ?? "sustain", staff: ev.staff };
          } else if (openPedal) {
            const span: Span = {
              type: openPedal.type,
              position: openPedal.position,
              end: { measure: measureId, position: ev.position },
            };
            if (openPedal.staff !== undefined) span.staff = openPedal.staff;
            pushSpan(pedalsByMeasure, openPedal.mi, span);
            openPedal = null;
          }
        }
      }

      mnxPart.measures.push(mnxMeasure);
    }

    // Any tie still open at the end of the part is an orphan start — a tie
    // with no matching stop (e.g. a malformed export, or a notehead tie drawn
    // without a destination). Reinterpret it as laissez-vibrer so it doesn't
    // leave a dangling target reference into a note that never materialised.
    for (const tie of tieIds.values()) {
      delete tie.target;
      tie.lv = true;
    }

    // Write buffered octave-shift spans onto their start measures (first-class
    // MNX `ottavas`, paired across measures above).
    writeOttavaSpans(mnxPart.measures, ottavasByMeasure);

    // Append standard gradual groups to each start measure's dynamics array.
    for (const [measureIndex, groups] of hairpinsByMeasure) {
      const measure = mnxPart.measures[measureIndex];
      if (measure) measure.dynamics = [...(measure.dynamics ?? []), ...groups];
    }

    // Write buffered vendor spans/expressions onto their start measures. Any
    // span still open at the end of the part is dropped (no valid end position).
    if (vendorExt) {
      for (let mi = 0; mi < mnxPart.measures.length; mi++) {
        const exprs = exprByMeasure.get(mi);
        const pedals = pedalsByMeasure.get(mi);
        if (!exprs && !pedals) continue;
        const vendorData: Record<string, unknown> = {};
        if (exprs) vendorData["expressions"] = exprs;
        if (pedals) vendorData["pedals"] = pedals;
        const measure = mnxPart.measures[mi]!;
        measure._x = { viritura: { ...measure._x?.viritura, ...vendorData } };
      }
    }

    mnxParts.push(mnxPart);
  }

  return { mnxParts, lyricLineIds };
}
