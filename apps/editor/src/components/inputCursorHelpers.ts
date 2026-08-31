import {
  findStaffAtPosition,
  snapToStaffPosition,
  paintInputCursor,
  paintGhostNote,
  paintBeatRuler,
  type StaffInfo,
  type DisplayList,
  type SpatialIndex,
} from "@viritura/renderer";
import type { Score, NoteValueBase, SequenceContent } from "@viritura/core";
import { durationToBeats, sequenceContentBeats } from "../commands/noteCommands";
import type { DotCount } from "../store/noteInputStore";

export const OPTIMISTIC_NOTE_INPUT_EVENT = "viritura:optimistic-note-input";

export interface OptimisticNoteInputDetail {
  cursor: { measureIndex: number; beatPosition: number; partIndex: number; staffIndex?: number };
  staffPosition: number;
  duration: string;
  accidental: string | null;
  isRest: boolean;
  /** Normal-mode preview independent of note-input activation. */
  optimisticOnly?: boolean;
  currentVoice?: number;
}

/** Data passed to the onClick callback when a note input click occurs. */
export interface NoteInputClickInfo {
  /** Score X coordinate of the click */
  scoreX: number;
  /** Snapped score Y coordinate (on nearest staff line/space) */
  scoreY: number;
  /** Staff line position (half-spaces from top line, 0 = top line) */
  staffPosition: number;
  /** The staff that was clicked on */
  staff: StaffInfo;
  /** Whether the Shift key was held during the click */
  shiftKey: boolean;
  /** Whether the Alt key was held during the click (16th-note snap override) */
  altKey: boolean;
}

export function resolveStaffForCursor(
  cursor: { measureIndex: number; partIndex: number; staffIndex?: number },
  staves: StaffInfo[],
  displayList?: DisplayList | null,
): StaffInfo | undefined {
  const partBounds = displayList?.measureBounds
    ?.filter((mb) => mb.index === cursor.measureIndex && mb.partIndex === (cursor.partIndex ?? 0))
    .sort((left, right) => left.y - right.y);
  if (partBounds && partBounds.length > 0 && staves.length > 0) {
    const targetBounds = partBounds[Math.min(cursor.staffIndex ?? 0, partBounds.length - 1)]!;
    return staves.reduce((best, staff) =>
      Math.abs(staff.y - targetBounds.y) < Math.abs(best.y - targetBounds.y) ? staff : best,
    );
  }
  const staffIdx = cursor.staffIndex ?? 0;
  return staves[Math.min(staffIdx, staves.length - 1)];
}

function collectTupletOnsets(
  content: readonly SequenceContent[],
  startBeat: number,
  durationScale: number,
  onsets: number[],
): number {
  let beat = startBeat;
  for (const item of content) {
    if (item.type === "event") {
      onsets.push(beat);
      beat += durationToBeats(item.duration) * durationScale;
    } else if (item.type === "tuplet") {
      const innerBeats = durationToBeats(item.inner.duration) * item.inner.multiple;
      const outerBeats = durationToBeats(item.outer.duration) * item.outer.multiple;
      const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
      beat = collectTupletOnsets(item.content, beat, durationScale * scale, onsets);
    } else {
      beat += sequenceContentBeats(item) * durationScale;
    }
  }
  return beat;
}

/**
 * Build a beat→X mapping for a measure.
 *
 * Uses the Rust engine's beat_anchors directly when available (exact positions).
 * Falls back to spatial index inference only for older engines without measureBounds.
 */
export function buildBeatMap(
  measureIndex: number,
  score: Score,
  si: SpatialIndex,
  voice: number,
  displayList?: DisplayList | null,
  partIndex: number = 0,
): { anchors: { beat: number; x: number }[]; measureLeft: number; measureRight: number; totalBeats: number } | null {
  // Try to use exact engine bounds first
  const engineBounds = displayList?.measureBounds?.find((b) => b.index === measureIndex && b.partIndex === partIndex);

  let anchors: { beat: number; x: number }[];
  let measureLeft: number;
  let measureRight: number;
  let totalBeats: number;

  if (engineBounds && engineBounds.beatAnchors && engineBounds.beatAnchors.length >= 2) {
    anchors = engineBounds.beatAnchors.map(([beat, x]) => ({ beat, x }));
    measureLeft = engineBounds.x + engineBounds.prefixWidth;
    measureRight = engineBounds.x + engineBounds.width;
    totalBeats = engineBounds.totalBeats;
  } else if (engineBounds) {
    measureLeft = engineBounds.x + engineBounds.prefixWidth;
    measureRight = engineBounds.x + engineBounds.width;
    totalBeats = engineBounds.totalBeats;
    anchors = [
      { beat: 0, x: measureLeft },
      { beat: totalBeats, x: measureRight },
    ];
  } else {
    // Fallback: no engine bounds, infer from spatial index
    totalBeats = 4.0;
    for (let m = measureIndex; m >= 0; m--) {
      const gm = score.global.measures[m];
      if (gm?.time) {
        totalBeats = (gm.time.count * 4) / gm.time.unit;
        break;
      }
    }

    const thisPrefix = `m${measureIndex}/`;
    const allMeasureEntries = si.all.filter((e) => e.id.includes(thisPrefix));
    if (allMeasureEntries.length === 0) return null;

    const eventEntries = allMeasureEntries.filter((e) => /\/s\d+\//.test(e.id));
    const boundsEntries = eventEntries.length > 0 ? eventEntries : allMeasureEntries;
    measureLeft = Math.min(...boundsEntries.map((e) => e.x));
    measureRight = Math.max(...boundsEntries.map((e) => e.x + e.width));
    anchors = [
      { beat: 0, x: measureLeft },
      { beat: totalBeats, x: measureRight },
    ];
  }

  // Augment anchors with tuplet event beats from the in-memory score.
  // The engine's anchors may miss tuplet subdivisions (e.g. if the WASM
  // layout was computed before the tuplet was created). This ensures the
  // snap grid and ruler always include tuplet-internal positions.
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[voice];
  if (seq && anchors.length >= 2) {
    const interpolationAnchors = [...anchors].sort((left, right) => left.beat - right.beat);
    const existingBeats = new Set(anchors.map((a) => Math.round(a.beat * 1000) / 1000));
    let pos = 0;
    for (const item of seq.content) {
      if (item.type === "tuplet") {
        const innerBeats = durationToBeats(item.inner.duration) * item.inner.multiple;
        const outerBeats = durationToBeats(item.outer.duration) * item.outer.multiple;
        const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
        const tupletOnsets: number[] = [];
        pos = collectTupletOnsets(item.content, pos, scale, tupletOnsets);
        for (const onset of tupletOnsets) {
          const rounded = Math.round(onset * 1000) / 1000;
          if (!existingBeats.has(rounded)) {
            anchors.push({ beat: onset, x: beatToX(onset, interpolationAnchors) });
            existingBeats.add(rounded);
          }
        }
      } else {
        pos += sequenceContentBeats(item);
      }
    }
    anchors.sort((a, b) => a.beat - b.beat);
  }

  return { anchors, measureLeft, measureRight, totalBeats };
}

/**
 * Interpolate an X position from a beat using the anchor points.
 */
function beatToX(beat: number, anchors: { beat: number; x: number }[]): number {
  if (anchors.length === 0) return 0;
  if (beat <= anchors[0]!.beat) return anchors[0]!.x;
  if (beat >= anchors[anchors.length - 1]!.beat) return anchors[anchors.length - 1]!.x;

  // Find the two anchors that bracket this beat and interpolate
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (beat >= a.beat - 1e-9 && beat <= b.beat + 1e-9) {
      const frac = b.beat - a.beat > 1e-9 ? (beat - a.beat) / (b.beat - a.beat) : 0;
      return a.x + frac * (b.x - a.x);
    }
  }
  return anchors[0]!.x;
}

/**
 * Interpolate a beat from an X position using the anchor points.
 */
function xToBeat(x: number, anchors: { beat: number; x: number }[]): number {
  if (anchors.length === 0) return 0;
  if (x <= anchors[0]!.x) return anchors[0]!.beat;
  if (x >= anchors[anchors.length - 1]!.x) return anchors[anchors.length - 1]!.beat;

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (x >= a.x - 1e-9 && x <= b.x + 1e-9) {
      const frac = b.x - a.x > 1e-9 ? (x - a.x) / (b.x - a.x) : 0;
      return a.beat + frac * (b.beat - a.beat);
    }
  }
  return anchors[0]!.beat;
}

/**
 * Build a merged snap grid for a measure: existing event onsets (from the engine's
 * beat anchors) UNION duration-based subdivisions for empty space.
 */
function buildSnapGrid(
  beatMap: { anchors: { beat: number; x: number }[]; totalBeats: number },
  noteBeats: number,
): number[] {
  const beats = new Set<number>();

  // Add all event onset beats from the engine anchors
  // (skip the last anchor which is the end-of-measure boundary)
  for (let i = 0; i < beatMap.anchors.length - 1; i++) {
    const beat = beatMap.anchors[i]!.beat;
    beats.add(Math.round(beat * 1000) / 1000); // round to avoid float noise
  }

  // Add duration-based grid subdivisions
  const lastBeat = beatMap.totalBeats - noteBeats;
  for (let beat = 0; beat <= lastBeat + 1e-9; beat += noteBeats) {
    beats.add(Math.round(beat * 1000) / 1000);
  }

  return [...beats].sort((a, b) => a - b);
}

/**
 * Find the measure index that a mouse position falls into.
 * Uses engine measure bounds when available, otherwise falls back
 * to a spatial index hit test.
 */
function findMeasureForMouse(
  mouseScoreX: number,
  mouseScoreY: number,
  si: SpatialIndex,
  displayList?: DisplayList | null,
): number | null {
  const bounds = displayList?.measureBounds;
  if (bounds && bounds.length > 0) {
    let bestDist = Infinity;
    let measureIndex: number | null = null;
    for (const mb of bounds) {
      if (mouseScoreX >= mb.x && mouseScoreX < mb.x + mb.width) {
        const dist = Math.abs(mb.y + mb.height / 2 - mouseScoreY);
        if (dist < bestDist) {
          bestDist = dist;
          measureIndex = mb.index;
        }
      }
    }
    if (measureIndex !== null) return measureIndex;
    // Mouse is past last or before first measure
    const sorted = [...bounds].sort((a, b) => a.x - b.x);
    const last = sorted[sorted.length - 1]!;
    const first = sorted[0]!;
    if (mouseScoreX >= last.x) return last.index;
    if (mouseScoreX < first.x) return first.index;
  }
  // Fallback to spatial index
  const nearestId = si.hitTest(mouseScoreX, mouseScoreY) ?? si.findNearest(mouseScoreX, mouseScoreY, 50);
  if (!nearestId) return null;
  const mMatch = nearestId.match(/m(\d+)/);
  if (!mMatch) return null;
  return parseInt(mMatch[1]!, 10);
}

/** Resolve which part the mouse Y falls into for a given measure. */
function resolvePartForMouse(
  measureIndex: number,
  mouseScoreY: number,
  displayList: DisplayList | null | undefined,
  fallback: number,
): number {
  const bounds = displayList?.measureBounds;
  if (!bounds) return fallback;
  let bestDist = Infinity;
  let resolved = fallback;
  for (const mb of bounds) {
    if (mb.index !== measureIndex) continue;
    const dist = Math.abs(mb.y + mb.height / 2 - mouseScoreY);
    if (dist < bestDist) {
      bestDist = dist;
      resolved = mb.partIndex;
    }
  }
  return resolved;
}

/**
 * Compute beat position and X coordinate from a mouse position.
 * Uses engine measure bounds for precise measure identification,
 * then the same anchor-based beat mapping as the ruler ticks.
 */
export function computeSnappedBeat(
  mouseScoreX: number,
  mouseScoreY: number,
  score: Score,
  si: SpatialIndex,
  voice: number,
  durationBase: NoteValueBase,
  dotCount: DotCount,
  displayList?: DisplayList | null,
  partIndexOverride?: number,
): { beat: number; x: number; measureIndex: number; partIndex: number } | null {
  const noteBeats = durationToBeats({
    base: durationBase,
    ...(dotCount > 0 ? { dots: dotCount } : {}),
  });

  const measureIndex = findMeasureForMouse(mouseScoreX, mouseScoreY, si, displayList);
  if (measureIndex === null) return null;

  const resolvedPartIndex = partIndexOverride ?? resolvePartForMouse(measureIndex, mouseScoreY, displayList, 0);

  const beatMap = buildBeatMap(measureIndex, score, si, voice, displayList, resolvedPartIndex);
  if (!beatMap) return null;

  // Convert mouse X to a raw beat using the anchor-based mapping
  const rawBeat = xToBeat(mouseScoreX, beatMap.anchors);

  // Build merged snap grid: event onsets + duration subdivisions
  const snapGrid = buildSnapGrid(beatMap, noteBeats);

  // Snap to nearest grid position
  let snappedBeat = 0;
  let bestDist = Infinity;
  for (const gridBeat of snapGrid) {
    const dist = Math.abs(rawBeat - gridBeat);
    if (dist < bestDist) {
      bestDist = dist;
      snappedBeat = gridBeat;
    }
  }

  // Convert snapped beat back to X using anchor-based mapping
  const snappedX = beatToX(snappedBeat, beatMap.anchors);

  return { beat: snappedBeat, x: snappedX, measureIndex, partIndex: resolvedPartIndex };
}

/**
 * Resolve the cursor's X position in score coordinates.
 * Uses the same buildBeatMap pipeline as the ruler and hover snap
 * so all three are always in agreement.
 */
function resolveCursorX(
  measureIndex: number,
  beatPosition: number,
  partIndex: number,
  voice: number,
  si: SpatialIndex,
  score: Score,
  displayList?: DisplayList | null,
): number | null {
  const beatMap = buildBeatMap(measureIndex, score, si, voice, displayList, partIndex);
  if (!beatMap) {
    // Geometry for this measure isn't available yet — common in horizon mode
    // when rapid entry crosses into a measure whose layout window hasn't caught
    // up to the cursor (the background re-engrave lags by the settle time). To
    // keep first-feedback instant, extrapolate from the nearest preceding
    // measure that does have geometry: a new measure begins at the right edge
    // of the previous one. The exact X is corrected when the real paint lands.
    for (let prev = measureIndex - 1; prev >= 0 && prev >= measureIndex - 4; prev--) {
      const prevMap = buildBeatMap(prev, score, si, voice, displayList, partIndex);
      if (prevMap) return prevMap.measureRight;
    }
    return null;
  }

  // Clamp beat position to valid range [0, totalBeats)
  if (beatPosition >= beatMap.totalBeats - 1e-9) {
    beatPosition = Math.max(0, beatMap.totalBeats - 1);
  }

  return beatToX(beatPosition, beatMap.anchors);
}

/** Voice colors matching standard notation convention. */
const VOICE_COLORS: Record<number, string> = {
  1: "#1565C0",
  2: "#2E7D32",
  3: "#E65100",
  4: "#6A1B9A",
};

/**
 * Paint the beat position cursor — a thicker line with a small triangle.
 * Color matches the active voice.
 */
function paintBeatCursor(ctx: CanvasRenderingContext2D, x: number, staff: StaffInfo, voiceNumber: number = 1): void {
  const margin = staff.spatium * 0.5;
  const top = staff.y - margin;
  const bottom = staff.y + staff.height + margin;
  const color = VOICE_COLORS[voiceNumber] ?? VOICE_COLORS[1]!;

  ctx.save();

  // Main cursor line
  ctx.strokeStyle = color + "E6"; // ~90% opacity
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();

  // Small triangle at top
  const triSize = staff.spatium * 0.4;
  ctx.fillStyle = color + "E6";
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x - triSize, top - triSize);
  ctx.lineTo(x + triSize, top - triSize);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Paint a ruler guide below the staff showing beat grid lines.
 * Uses the same anchor-based mapping (buildBeatMap + beatToX) as
 * computeSnappedBeat, so tick positions exactly match the snap hitboxes.
 */
function paintRulerGuide(
  ctx: CanvasRenderingContext2D,
  measureIndex: number,
  score: Score,
  si: SpatialIndex,
  staff: StaffInfo,
  noteBeats: number,
  activeBeat: number,
  voice: number,
  displayList?: DisplayList | null,
  partIndex: number = 0,
): void {
  const beatMap = buildBeatMap(measureIndex, score, si, voice, displayList, partIndex);
  if (!beatMap) return;

  const { anchors } = beatMap;

  const rulerY = staff.y + staff.height + staff.spatium * 1.5;

  ctx.save();

  // Build merged snap grid: event onsets + duration subdivisions
  const snapGrid = buildSnapGrid(beatMap, noteBeats);

  // Convert to RulerTick format for the shared painter
  const ticks: Array<{ x: number; beat: number; isEventOnset?: boolean; active?: boolean }> = [];
  for (const beat of snapGrid) {
    const x = beatToX(beat, anchors);
    const isEventOnset = beatMap.anchors.some(
      (a, i) => i < beatMap.anchors.length - 1 && Math.abs(a.beat - beat) < 1e-9,
    );
    const isActive = Math.abs(beat - activeBeat) < 1e-9;
    ticks.push({ x, beat, isEventOnset, active: isActive });
  }

  paintBeatRuler(ctx, ticks, {
    rulerY,
    spatium: staff.spatium,
  });

  ctx.restore();
}

/**
 * Ensure the canvas backing pixels match its CSS size at the current DPR.
 * Returns true if the canvas was resized.
 */
export function ensureCanvasSize(canvas: HTMLCanvasElement, dpr: number): boolean {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const expectedW = Math.round(cssW * dpr);
  const expectedH = Math.round(cssH * dpr);
  if (canvas.width !== expectedW || canvas.height !== expectedH) {
    canvas.width = expectedW;
    canvas.height = expectedH;
    return true;
  }
  return false;
}

/** Apply the score canvas viewport transform to the overlay context. */
export function applyOverlayTransform(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dpr: number,
  zoom: number,
  scrollX: number,
  scrollY: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -scrollX * dpr * zoom, -scrollY * dpr * zoom);
}

/** Options for painting the live input overlay (cursor + ghost note). */
export interface PaintOverlayOptions {
  cursor: { measureIndex: number; beatPosition: number; partIndex: number; staffIndex?: number } | null;
  mouse: { x: number; y: number } | null;
  altKey: boolean;
  staves: StaffInfo[];
  spatialIndex: SpatialIndex | null;
  score: Score | null;
  displayList: DisplayList | null;
  currentVoice: number;
  currentDuration: NoteValueBase;
  currentAccidental: string | null;
  isRest: boolean;
  dotCount: DotCount;
  zoom: number;
  scrollX: number;
  scrollY: number;
  onHoverBeat?: (info: { measureIndex: number; beat: number; scoreX: number } | null) => void;
}

/** Paint the persistent beat cursor + the mouse-following ghost note. */
export function paintInputOverlay(ctx: CanvasRenderingContext2D, opts: PaintOverlayOptions): void {
  const { cursor, mouse, altKey, staves, spatialIndex, score, displayList, currentVoice } = opts;

  // Persistent beat cursor (independent of mouse)
  if (cursor && spatialIndex && score && staves.length > 0) {
    const cursorX = resolveCursorX(
      cursor.measureIndex,
      cursor.beatPosition,
      cursor.partIndex,
      currentVoice - 1,
      spatialIndex,
      score,
      displayList,
    );
    if (cursorX !== null) {
      const staff = resolveStaffForCursor(cursor, staves, displayList);
      if (staff) paintBeatCursor(ctx, cursorX, staff, currentVoice);
    }
  }

  if (!mouse || !spatialIndex || !score) {
    opts.onHoverBeat?.(null);
    return;
  }

  const scoreX = mouse.x / opts.zoom + opts.scrollX;
  const scoreY = mouse.y / opts.zoom + opts.scrollY;
  const staff = findStaffAtPosition(staves, scoreX, scoreY);
  if (!staff) {
    opts.onHoverBeat?.(null);
    return;
  }

  const snappedY = snapToStaffPosition(scoreY, staff);

  // Alt key overrides snap resolution to 16th notes
  const effectiveDuration = altKey ? ("16th" as NoteValueBase) : opts.currentDuration;
  const effectiveDots = altKey ? (0 as DotCount) : opts.dotCount;
  const snapped = computeSnappedBeat(
    scoreX,
    scoreY,
    score,
    spatialIndex,
    currentVoice - 1,
    effectiveDuration,
    effectiveDots,
    displayList,
  );

  let ghostX = scoreX;
  if (snapped) {
    ghostX = snapped.x;
    opts.onHoverBeat?.({ measureIndex: snapped.measureIndex, beat: snapped.beat, scoreX });
    const noteBeats = durationToBeats({
      base: effectiveDuration,
      ...(effectiveDots > 0 ? { dots: effectiveDots } : {}),
    });
    paintRulerGuide(
      ctx,
      snapped.measureIndex,
      score,
      spatialIndex,
      staff,
      noteBeats,
      snapped.beat,
      currentVoice - 1,
      displayList,
      snapped.partIndex,
    );
  } else {
    opts.onHoverBeat?.(null);
  }

  paintInputCursor(ctx, ghostX, staff);
  paintGhostNote(ctx, {
    y: snappedY,
    x: ghostX,
    staff,
    duration: opts.currentDuration,
    accidental: opts.currentAccidental,
    isRest: opts.isRest,
  });
}

/** Options for painting an optimistic note input preview. */
export interface PaintOptimisticOptions {
  detail: OptimisticNoteInputDetail;
  staves: StaffInfo[];
  spatialIndex: SpatialIndex;
  score: Score;
  displayList: DisplayList | null;
  currentVoice: number;
}

/**
 * Paint an immediate ghost note + cursor preview for an optimistic input.
 * Returns true if a paint was performed.
 */
export function paintOptimisticOverlay(ctx: CanvasRenderingContext2D, opts: PaintOptimisticOptions): boolean {
  const { detail, staves, spatialIndex, score, displayList } = opts;
  const currentVoice = detail.currentVoice ?? opts.currentVoice;
  const cursorX = resolveCursorX(
    detail.cursor.measureIndex,
    detail.cursor.beatPosition,
    detail.cursor.partIndex,
    currentVoice - 1,
    spatialIndex,
    score,
    displayList,
  );
  if (cursorX === null) return false;
  const staff = resolveStaffForCursor(detail.cursor, staves, displayList);
  if (!staff) return false;

  paintBeatCursor(ctx, cursorX, staff, currentVoice);
  paintGhostNote(ctx, {
    y: staff.y + detail.staffPosition * (staff.spatium / 2),
    x: cursorX,
    staff,
    duration: detail.duration,
    accidental: detail.accidental,
    isRest: detail.isRest,
  });
  return true;
}
