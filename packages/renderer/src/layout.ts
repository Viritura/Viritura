/**
 * Score layout computation.
 *
 * Takes a Score model and produces positioned elements ready for painting.
 *
 * @deprecated This TypeScript layout is a legacy fallback. The production
 * layout engine is now in Rust/WASM (engine/viritura-engine). Use the WASM
 * renderer for full multi-voice, beam, tie, slur, and tuplet support.
 */

import type { Score, ResolvedMeasure, NoteEvent, TimeSignature, KeySignature, LayoutSettings } from "@viritura/core";
import { diatonicPosition, clefReferencePitch, DURATION_BEATS } from "@viritura/core";

// ═══════════════════════════════════════════
// Layout types
// ═══════════════════════════════════════════

export interface LayoutPage {
  systems: LayoutSystem[];
  width: number;
  height: number;
}

export interface LayoutSystem {
  x: number;
  y: number;
  measures: LayoutMeasure[];
  staffY: number; // Y position of the top staff line
}

export interface LayoutMeasure {
  x: number;
  width: number;
  resolved: ResolvedMeasure;
  events: LayoutEvent[];
  /** X offset where notes start (after clef/keysig/timesig) */
  contentStartX: number;
  /** Voice index for each event (for multi-voice stem direction) */
  voiceEvents: { voiceIndex: number; events: LayoutEvent[] }[];
}

export interface LayoutEvent {
  x: number;
  event: NoteEvent;
  /** Staff positions of each note (relative to top staff line, in half-spaces) */
  notePositions: number[];
  /** Stem direction */
  stemUp: boolean;
  /** Voice index (0 = stems up default, 1 = stems down default) */
  voiceIndex: number;
}

// ═══════════════════════════════════════════
// Layout computation
// ═══════════════════════════════════════════

/**
 * Compute layout for a single part of the score.
 *
 * @deprecated Use the Rust/WASM layout engine instead. This fallback only
 * handles a single voice and lacks beam, tie, slur, and tuplet support.
 */
export function computeLayout(score: Score, partIndex: number, settings: LayoutSettings): LayoutPage {
  const sp = settings.spatiumPx;
  const part = score.parts[partIndex];
  if (!part) throw new Error(`Part ${partIndex} not found`);

  // Resolve measures (merge global + part data, inherit time/key sigs)
  const resolved = resolveMeasures(score, partIndex);

  // For now: single system layout (all measures on one line)
  // TODO: system breaking (line wrapping)
  const marginLeft = settings.margins.left * sp;
  const marginTop = settings.margins.top * sp;
  const staffY = marginTop;

  // Compute measure widths
  const layoutMeasures = computeMeasureLayouts(resolved, sp, marginLeft, staffY);

  const totalWidth = layoutMeasures.reduce((sum, m) => sum + m.width, 0) + marginLeft * 2;
  const staffHeight = 4 * sp; // 5 lines = 4 spaces

  const system: LayoutSystem = {
    x: marginLeft,
    y: marginTop,
    staffY,
    measures: layoutMeasures,
  };

  return {
    systems: [system],
    width: Math.max(totalWidth, 800),
    height: staffHeight + marginTop * 2 + 100,
  };
}

// ═══════════════════════════════════════════
// Resolve measures (merge global + part data)
// ═══════════════════════════════════════════

function resolveMeasures(score: Score, partIndex: number): ResolvedMeasure[] {
  const part = score.parts[partIndex]!;
  const globalMeasures = score.global.measures;

  let activeTime: TimeSignature = { count: 4, unit: 4 };
  let activeKey: KeySignature = { fifths: 0 };

  const result: ResolvedMeasure[] = [];

  for (let i = 0; i < Math.max(globalMeasures.length, part.measures.length); i++) {
    const global = globalMeasures[i] ?? {};
    const partMeasure = part.measures[i] ?? { sequences: [] };

    if (global.time) activeTime = global.time;
    if (global.key) activeKey = global.key;

    result.push({
      index: i,
      global,
      part: partMeasure,
      activeTime: { ...activeTime },
      activeKey: { ...activeKey },
    });
  }

  return result;
}

// ═══════════════════════════════════════════
// Measure layout
// ═══════════════════════════════════════════

function computeMeasureLayouts(
  resolved: ResolvedMeasure[],
  sp: number,
  startX: number,
  staffY: number,
): LayoutMeasure[] {
  let xCursor = startX;
  const measures: LayoutMeasure[] = [];

  for (const rm of resolved) {
    const ml = computeSingleMeasureLayout(rm, sp, xCursor, staffY);
    measures.push(ml);
    xCursor += ml.width;
  }

  return measures;
}

function computeSingleMeasureLayout(rm: ResolvedMeasure, sp: number, startX: number, _staffY: number): LayoutMeasure {
  const isFirstMeasure = rm.index === 0;

  // Prefix width: clef + key sig + time sig (only in first measure or on change)
  let prefixWidth = 0;

  // Clef
  const hasClef = isFirstMeasure && rm.part.clefs && rm.part.clefs.length > 0;
  if (hasClef) {
    prefixWidth += 3.0 * sp; // clef width
  }

  // Key signature
  const hasKeySig = rm.global.key !== undefined || (isFirstMeasure && rm.activeKey.fifths !== 0);
  if (hasKeySig) {
    const accidentals = Math.abs(rm.activeKey.fifths);
    prefixWidth += (accidentals * 0.7 + 0.5) * sp;
  }

  // Time signature
  const hasTimeSig = rm.global.time !== undefined;
  if (hasTimeSig) {
    prefixWidth += 2.5 * sp;
  }

  // Add a small gap after prefix
  if (prefixWidth > 0) {
    prefixWidth += 0.5 * sp;
  }

  // Compute note events
  // NOTE: Only reads sequences[0] (first voice). The Rust/WASM engine
  // handles all voices; this fallback is single-voice only.
  const seq = rm.part.sequences[0];
  const events = (seq?.content ?? []).filter((c): c is NoteEvent => c.type === "event");

  // Total beats in this measure
  const totalBeats = (rm.activeTime.count * 4) / rm.activeTime.unit;

  // Minimum measure width based on number of events
  const noteSpacing = 3.5 * sp; // Base note-to-note distance
  const contentWidth = Math.max(events.length * noteSpacing, 4 * sp);

  const measureWidth = prefixWidth + contentWidth + 1.0 * sp; // trailing padding

  // Position each event
  const layoutEvents: LayoutEvent[] = [];
  let beatCursor = 0;

  // Get the clef reference for staff position calculation
  const clef = rm.part.clefs?.[0]?.clef ?? { sign: "G" as const, staffPosition: -2 };
  const clefRef = clefReferencePitch(clef);
  // For a treble clef, the reference is G4 (diatonic 32) on line 1 from bottom (line index 1)
  // Staff position 0 = top line (line 4 from bottom)
  // Each staff position = half a staff space

  for (const ev of events) {
    // X position: distribute evenly for now
    const beatPos = beatCursor / totalBeats;
    const evX = startX + prefixWidth + beatPos * contentWidth;

    // Compute note staff positions
    const notePositions: number[] = [];
    if (ev.notes && ev.notes.length > 0) {
      for (const note of ev.notes) {
        const diatonic = diatonicPosition(note.pitch);
        // Staff position relative to top line: higher diatonic = higher on staff = lower number
        // Treble clef: G4 is on line 1 from bottom (= line 3 from top in 5-line staff = staff position 6)
        // The clef reference diatonic position sits on the clef line
        const clefLine = clefLineFromBottom(clef);
        const posFromClefLine = diatonic - clefRef;
        // Convert to positions from top line (each step = 1 half-space)
        // Line 4 (top, 0-based from bottom) = 0 staff positions from top
        // Line 0 (bottom) = 8 staff positions from top
        const posFromTop = (4 - clefLine) * 2 - posFromClefLine;
        notePositions.push(posFromTop);
      }
    }

    // Determine stem direction (simplistic: below middle = stems up)
    const avgPos = notePositions.length > 0 ? notePositions.reduce((a, b) => a + b, 0) / notePositions.length : 4;
    const stemUp = avgPos >= 4; // >= middle line: stems up

    layoutEvents.push({
      x: evX,
      event: ev,
      notePositions,
      stemUp,
      voiceIndex: 0,
    });

    const beats = DURATION_BEATS[ev.duration.base] ?? 1;
    const dots = ev.duration.dots ?? 0;
    let totalDuration = beats;
    for (let d = 0; d < dots; d++) {
      totalDuration += beats / Math.pow(2, d + 1);
    }
    beatCursor += totalDuration;
  }

  return {
    x: startX,
    width: measureWidth,
    resolved: rm,
    events: layoutEvents,
    contentStartX: startX + prefixWidth,
    voiceEvents: [{ voiceIndex: 0, events: layoutEvents }],
  };
}

// Helper: get clef line from bottom (0-indexed)
function clefLineFromBottom(clef: { sign: string; staffPosition: number }): number {
  // MNX staffPosition: treble G clef = -2 (sits on line 2 from bottom, 0-based)
  // staffPosition is in half-spaces from center line
  // center line = line 2 from bottom
  return 2 + Math.round(clef.staffPosition / 2);
}
