import type { MeasureBounds } from "@viritura/renderer";
import type { EngraveAdornments, EngraveBreakMarker, EngraveStaffEye, StaffEyeHit } from "./ScoreCanvas";

/** Marker pill diameter in engine layout pixels (≈ 3.7 sp at sp=12). */
export const ENGRAVE_MARKER_SIZE = 44;
/** Horizontal gap from the right barline to the marker centre (≈ 2.5 sp). */
const ENGRAVE_MARKER_GAP_RIGHT = 30;

/** Eye-pill diameter — kept numerically equal to the break-marker size for
 * visual parity, but expressed independently so callers can tune each axis
 * without affecting the other. */
export const ENGRAVE_EYE_SIZE = 44;

const GHOST_RAIL_RING = 12;
const GHOST_RAIL_GAP_PX = 30; // fallback half-spacing when one neighbour missing

/**
 * Returns the topmost-staff bounds and full system span for a given measure
 * index. Engrave markers are drawn once per system, anchored above the topmost
 * staff at the right barline of the last measure of that system.
 */
function topStaffBoundsForMeasure(measureIndex: number, measureBounds: MeasureBounds[]): MeasureBounds | null {
  let best: MeasureBounds | null = null;
  for (const m of measureBounds) {
    if (m.index !== measureIndex) continue;
    if (!best || m.y < best.y) best = m;
  }
  return best;
}

/**
 * Compute the on-screen marker centre for a given measure index. The marker
 * sits in the right margin, centred vertically on the **topmost staff** of
 * the system (regardless of how many staves the system has). Returns the
 * point used both for painting and hit-testing so they cannot drift apart.
 */
export function markerCenterForMeasure(
  measureIndex: number,
  measureBounds: MeasureBounds[],
): { cx: number; cy: number; topMb: MeasureBounds } | null {
  const topMb = topStaffBoundsForMeasure(measureIndex, measureBounds);
  if (!topMb) return null;
  const cx = topMb.x + topMb.width + ENGRAVE_MARKER_GAP_RIGHT + ENGRAVE_MARKER_SIZE / 2;
  const cy = topMb.y + topMb.height / 2;
  return { cx, cy, topMb };
}

/** Hit-test a click against the rendered engrave break markers. */
export function findMarkerHit(
  scoreX: number,
  scoreY: number,
  markers: EngraveBreakMarker[],
  measureBounds: MeasureBounds[],
): EngraveBreakMarker | null {
  for (const mk of markers) {
    const c = markerCenterForMeasure(mk.measureIndex, measureBounds);
    if (!c) continue;
    const half = ENGRAVE_MARKER_SIZE / 2 + 3;
    if (scoreX >= c.cx - half && scoreX <= c.cx + half && scoreY >= c.cy - half && scoreY <= c.cy + half) {
      return mk;
    }
  }
  return null;
}

/**
 * Build a lookup of the first (min-x) `MeasureBounds` for each
 * `${systemIndex}|${partIndex}` pair. Built **once** per paint/hit-test pass
 * and shared by staff-eye derivation, painting, and hit-testing so none of
 * them re-scan `measureBounds` per eye — that scan was O(eyes × bounds),
 * i.e. quadratic in score size, and dominated engrave-mode paint on large
 * orchestral scores (tens of seconds of self time per frame).
 */
function buildStaffMeasureIndex(measureBounds: MeasureBounds[]): Map<string, MeasureBounds> {
  const firstByKey = new Map<string, MeasureBounds>();
  for (const mb of measureBounds) {
    const key = `${mb.systemIndex ?? 0}|${mb.partIndex}`;
    const existing = firstByKey.get(key);
    if (!existing || mb.x < existing.x) firstByKey.set(key, mb);
  }
  return firstByKey;
}

/**
 * Compute the on-screen anchor for a staff-eye pill. The pill sits in the
 * left margin, just before the clef of the first measure of the staff's
 * containing system. Uses the bounds matching `(systemIndex, partIndex)` —
 * for ghost rails this is the placeholder bounds emitted by the engine.
 * Takes a prebuilt index (see `buildStaffMeasureIndex`) for O(1) lookup.
 */
export function staffEyeCenter(
  eye: EngraveStaffEye,
  measureIndex: Map<string, MeasureBounds>,
  pageMarginLeftPx: number,
): { cx: number; cy: number; mb: MeasureBounds } | null {
  const target = measureIndex.get(`${eye.systemIndex}|${eye.partIndex}`);
  if (!target) return null;
  // Horizontally centred in the page's left margin (page edge x=0 → margin
  // ends at pageMarginLeftPx). Vertically centred on the staff itself.
  const cx = pageMarginLeftPx / 2;
  const cy = target.y + target.height / 2;
  return { cx, cy, mb: target };
}

/** Hit-test a click against the rendered staff-eye pills. */
export function findStaffEyeHit(
  scoreX: number,
  scoreY: number,
  eyes: EngraveStaffEye[],
  measureBounds: MeasureBounds[],
  pageMarginLeftPx: number,
): StaffEyeHit | null {
  const measureIndex = buildStaffMeasureIndex(measureBounds);
  for (const eye of eyes) {
    const c = staffEyeCenter(eye, measureIndex, pageMarginLeftPx);
    if (!c) continue;
    const half = ENGRAVE_EYE_SIZE / 2 + 3;
    if (scoreX >= c.cx - half && scoreX <= c.cx + half && scoreY >= c.cy - half && scoreY <= c.cy + half) {
      return { id: eye.id, systemMeasureId: eye.systemMeasureId, partId: eye.partId, visible: eye.visible };
    }
  }
  return null;
}

/**
 * Enumerate one EngraveStaffEye per (engine system, part) by walking
 * `MeasureBounds` and asking the provider for state. Skips entries where the
 * provider returns `null` (e.g. when there is no MNX `pages[]` snapshot yet
 * and the host doesn't want eyes painted).
 */
function deriveStaffEyes(
  measureBounds: MeasureBounds[],
  partIdByIndex: readonly string[],
  provider: NonNullable<EngraveAdornments["staffEyeProvider"]>,
): EngraveStaffEye[] {
  // Find the first measure of each (systemIndex, partIndex) pair.
  const firstByKey = buildStaffMeasureIndex(measureBounds);
  const out: EngraveStaffEye[] = [];
  for (const [key, mb] of firstByKey) {
    const partId = partIdByIndex[mb.partIndex];
    if (!partId || !mb.measureId) continue;
    const state = provider(mb.measureId, partId);
    if (!state) continue;
    out.push({
      id: `eye:${key}:${mb.measureId}:${partId}`,
      systemMeasureId: mb.measureId,
      partId,
      visible: state.visible,
      hasMusicHidden: state.hasMusicHidden,
      systemIndex: mb.systemIndex ?? 0,
      partIndex: mb.partIndex,
    });
  }
  return out;
}

/** Geometry of one painted ghost rail (collapsed run of hidden staves). */
export interface DerivedGhostRail {
  id: string;
  systemMeasureId: string;
  partIds: string[];
  partLabels: string[];
  /** Hidden parts grouped by shared LayoutStaff (one inner array per staff). */
  staffGroups: string[][];
  /** Display label per staffGroups inner array. */
  staffGroupLabels: string[];
  /** Parallel to staffGroups: true if that staff has music in the hidden range. */
  staffGroupHasMusic: boolean[];
  /** True when *any* hidden staff in the rail contains music. */
  hasMusicHidden: boolean;
  isMulti: boolean;
  /** Centre x in score/layout pixels (page-margin centre, where the ring sits). */
  cx: number;
  /** Centre y in score/layout pixels (between adjacent visible staves). */
  cy: number;
  /** Left edge of the red rail line (x just right of the ring). */
  railLeftX: number;
  /** Right edge of the red rail line (right edge of the system's last measure). */
  railRightX: number;
}

// eslint-disable-next-line complexity -- per-system staff iteration with branchy include/exclude rules from the user-supplied group provider (top staff, bottom staff, range membership, group-span clipping). Each rule reads the same MeasureBounds but answers a different question; flattening to one pass keeps the per-staff bookkeeping in scope.
function deriveGhostRails(
  measureBounds: MeasureBounds[],
  partIdByIndex: readonly string[],
  groupProvider: NonNullable<EngraveAdornments["ghostRailGroupProvider"]>,
  pageMarginLeftPx: number,
): DerivedGhostRail[] {
  const out: DerivedGhostRail[] = [];
  const bySystem = new Map<number, MeasureBounds[]>();
  for (const mb of measureBounds) {
    const si = mb.systemIndex ?? 0;
    let arr = bySystem.get(si);
    if (!arr) {
      arr = [];
      bySystem.set(si, arr);
    }
    arr.push(mb);
  }
  const cx = pageMarginLeftPx / 2;
  for (const mbs of bySystem.values()) {
    let firstMb: MeasureBounds | null = null;
    let leftX = Infinity;
    for (const mb of mbs) {
      if (!firstMb || mb.x < firstMb.x) firstMb = mb;
      if (mb.x < leftX) leftX = mb.x;
    }
    if (!firstMb?.measureId) continue;
    const groups = groupProvider(firstMb.measureId);
    if (groups.length === 0) continue;

    // Per-part Y extent in this system (visible staves only).
    const partY = new Map<string, { top: number; bottom: number }>();
    for (const mb of mbs) {
      const pid = partIdByIndex[mb.partIndex];
      if (!pid) continue;
      const top = mb.y;
      const bottom = mb.y + mb.height;
      const ext = partY.get(pid);
      if (!ext) partY.set(pid, { top, bottom });
      else partY.set(pid, { top: Math.min(ext.top, top), bottom: Math.max(ext.bottom, bottom) });
    }

    for (const g of groups) {
      const above = g.aboveVisiblePartId ? partY.get(g.aboveVisiblePartId) : null;
      const below = g.belowVisiblePartId ? partY.get(g.belowVisiblePartId) : null;
      let cy: number;
      if (above && below) cy = (above.bottom + below.top) / 2;
      else if (above) cy = above.bottom + GHOST_RAIL_GAP_PX;
      else if (below) cy = below.top - GHOST_RAIL_GAP_PX;
      else continue;
      const sgs = g.staffGroups ?? g.partIds.map((p) => [p]);
      const sgMusic = g.staffGroupHasMusic ?? sgs.map(() => false);
      out.push({
        id: g.id,
        systemMeasureId: firstMb.measureId,
        partIds: g.partIds,
        partLabels: g.partLabels ?? g.partIds,
        staffGroups: sgs,
        staffGroupLabels:
          g.staffGroupLabels ??
          sgs.map((arr) =>
            arr
              .map((p) => {
                const idx = g.partIds.indexOf(p);
                return g.partLabels?.[idx] ?? p;
              })
              .join(" / "),
          ),
        staffGroupHasMusic: sgMusic,
        hasMusicHidden: sgMusic.some(Boolean),
        // "Multi" for popover purposes = more than one *staff*, not more
        // than one part. A single condensed staff with multiple sources
        // should still toggle as one unit (no popover, direct click).
        isMulti: sgs.length > 1,
        cx,
        cy,
        railLeftX: cx + ENGRAVE_EYE_SIZE / 2,
        railRightX: leftX,
      });
    }
  }
  return out;
}

/**
 * Hit-test a click against *any* ghost rail's ring (single- or multi-staff),
 * returning the full descriptor. The canvas click handler uses this to decide
 * whether to toggle a single staff directly (`isMulti === false`) or open the
 * Radix popover (`isMulti === true`). The hit radius matches the per-rail ring
 * used by the hover loop so click and cursor stay consistent.
 */
export function findGhostRailHitFull(
  scoreX: number,
  scoreY: number,
  rails: DerivedGhostRail[],
): DerivedGhostRail | null {
  for (const rail of rails) {
    const r = (rail.isMulti ? ENGRAVE_EYE_SIZE / 2 : GHOST_RAIL_RING) + 4;
    if (scoreX >= rail.cx - r && scoreX <= rail.cx + r && scoreY >= rail.cy - r && scoreY <= rail.cy + r) {
      return rail;
    }
  }
  return null;
}

/**
 * Memoized bundle of every engrave-mode anchor derivation for one display
 * list: staff-eyes, the staff-measure index they anchor against, and ghost
 * rails. Each derivation walks every (system, part) and calls the visibility
 * provider — O(systems × parts) work (the provider itself is O(parts)), so the
 * bundle is effectively O(systems × parts²). It previously re-ran on *every*
 * paint, hover-fade animation frame, and mousemove hit-test, which made large
 * condensed scores feel hung on the slightest interaction.
 *
 * The derivations only change when the engine produces a new layout, and a new
 * layout always yields a fresh `measureBounds` array (visibility toggles, part
 * add/remove, page-setup changes all relayout). So we key the cache on that
 * array's identity: repaints, fade frames, and mousemoves over an unchanged
 * layout reuse the cached result and pay the walk exactly once per layout.
 */
export interface DerivedEngraveAnchors {
  eyes: EngraveStaffEye[];
  staffMeasureIndex: Map<string, MeasureBounds> | null;
  rails: DerivedGhostRail[];
}

const anchorCache = new WeakMap<MeasureBounds[], DerivedEngraveAnchors>();

export function deriveEngraveAnchors(
  measureBounds: MeasureBounds[],
  partIdByIndex: readonly string[],
  provider: EngraveAdornments["staffEyeProvider"] | undefined,
  groupProvider: EngraveAdornments["ghostRailGroupProvider"] | undefined,
  pageMarginLeftPx: number,
): DerivedEngraveAnchors {
  const cached = anchorCache.get(measureBounds);
  if (cached) return cached;
  const eyes = provider ? deriveStaffEyes(measureBounds, partIdByIndex, provider) : [];
  const staffMeasureIndex = eyes.length > 0 ? buildStaffMeasureIndex(measureBounds) : null;
  const rails = groupProvider ? deriveGhostRails(measureBounds, partIdByIndex, groupProvider, pageMarginLeftPx) : [];
  const derived: DerivedEngraveAnchors = { eyes, staffMeasureIndex, rails };
  anchorCache.set(measureBounds, derived);
  return derived;
}
