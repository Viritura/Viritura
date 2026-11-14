import { computeKeySignaturePositions, type DisplayList, type DrawGlyph } from "./wasm";
import type { StaffInfo, StickyClefInfo } from "./overlayPainter";

const FLAT = 0xe260;
const NATURAL = 0xe261;
const SHARP = 0xe262;
const KEY_ELEMENT_ID = /^p\d+\/m(\d+)\/key$/;
const KEY_GAP_SPATIA = 0.2;
const ACCIDENTAL_ADVANCE_SPATIA = 1.1;

export interface StickyKeySignature {
  x: number;
  initial: boolean;
  glyphs: DrawGlyph[];
}

interface KeyRun {
  elementId: string;
  measureIndex: number;
  glyphs: DrawGlyph[];
}

type KeyClefSign = "G" | "F" | "C" | "P";

export interface StickyClefContext {
  x: number;
  sign: KeyClefSign;
}

function isKeyAccidental(codepoint: number): boolean {
  return codepoint === FLAT || codepoint === NATURAL || codepoint === SHARP;
}

function collectKeyRuns(displayList: DisplayList): Map<string, KeyRun[]> {
  const runs = new Map<string, KeyRun[]>();
  let current: KeyRun | undefined;
  for (let i = 0; i < displayList.commands.length; i++) {
    const command = displayList.commands[i]!;
    const elementId = displayList.elementIds?.[i];
    const match = elementId?.match(KEY_ELEMENT_ID);
    if (command.type !== "DrawGlyph" || !match || !isKeyAccidental(command.codepoint)) {
      current = undefined;
      continue;
    }

    const previous = current?.glyphs.at(-1);
    if (!current || current.elementId !== elementId || (previous && command.x <= previous.x)) {
      current = { elementId: elementId!, measureIndex: Number(match[1]), glyphs: [] };
      const entries = runs.get(elementId!);
      if (entries) entries.push(current);
      else runs.set(elementId!, [current]);
    }
    current.glyphs.push(command);
  }
  return runs;
}

function nearestStaff(staves: readonly StaffInfo[], y: number, candidates: readonly number[]): number | undefined {
  let nearest: number | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const index of candidates) {
    const staff = staves[index]!;
    const nextDistance = Math.abs(y - (staff.y + staff.height / 2));
    if (nextDistance < distance) {
      nearest = index;
      distance = nextDistance;
    }
  }
  return nearest;
}

function runY(run: KeyRun): number {
  return run.glyphs.reduce((sum, glyph) => sum + glyph.y, 0) / run.glyphs.length;
}

/**
 * Use the engine's key tags, rather than accidental codepoints alone, so note
 * accidentals never become part of the rail. A run containing only naturals
 * marks a change to a key with no signature.
 */
export function extractStickyKeySignatures(
  displayList: DisplayList,
  staves: readonly StaffInfo[],
): StickyKeySignature[][] {
  const result: StickyKeySignature[][] = staves.map(() => []);
  const runsById = collectKeyRuns(displayList);
  if (runsById.size === 0) return result;
  const candidatesById = new Map<string, Set<number>>();
  const firstMeasures = staves.map(() => Number.POSITIVE_INFINITY);
  const allStaffIndices = staves.map((_, index) => index);
  const staffByTop = new Map(staves.map((staff, index) => [staff.y, index]));
  const keyMeasures = new Set([...runsById.values()].map((runs) => runs[0]!.measureIndex));

  for (const bound of displayList.measureBounds ?? []) {
    if (bound.isHidden) continue;
    const staffIndex = staffByTop.get(bound.y) ?? nearestStaff(staves, bound.y + bound.height / 2, allStaffIndices);
    if (staffIndex === undefined) continue;
    firstMeasures[staffIndex] = Math.min(firstMeasures[staffIndex]!, bound.index);
    if (!keyMeasures.has(bound.index)) continue;
    const id = `p${bound.partIndex}/m${bound.index}/key`;
    if (!runsById.has(id)) continue;
    const candidates = candidatesById.get(id);
    if (candidates) candidates.add(staffIndex);
    else candidatesById.set(id, new Set([staffIndex]));
  }

  for (const [id, runs] of runsById) {
    const candidates = [...(candidatesById.get(id) ?? allStaffIndices)].sort((a, b) => staves[a]!.y - staves[b]!.y);
    runs.sort((a, b) => runY(a) - runY(b));
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      const staffIndex =
        runs.length === candidates.length ? candidates[i] : nearestStaff(staves, runY(run), candidates);
      if (staffIndex === undefined) continue;
      const firstMeasure = firstMeasures[staffIndex]!;
      result[staffIndex]!.push({
        x: run.glyphs[0]!.x,
        initial: run.measureIndex === (Number.isFinite(firstMeasure) ? firstMeasure : 0),
        glyphs: run.glyphs.filter((glyph) => glyph.codepoint !== NATURAL),
      });
    }
  }

  for (const signatures of result) signatures.sort((a, b) => a.x - b.x);
  return result;
}

export function extractStickyClefContexts(
  displayList: DisplayList,
  staves: readonly StaffInfo[],
  info: readonly StickyClefInfo[],
): StickyClefContext[][] {
  const result: StickyClefContext[][] = staves.map(() => []);
  const staffByTop = new Map(staves.map((staff, index) => [staff.y, index]));
  const allStaffIndices = staves.map((_, index) => index);
  const clefXs = info.map((staff) => {
    const byId = new Map<string, number[]>();
    for (const clef of staff.clefs) {
      if (!clef.elementId) continue;
      const xs = byId.get(clef.elementId);
      if (xs) xs.push(clef.x);
      else byId.set(clef.elementId, [clef.x]);
    }
    return byId;
  });
  for (const bound of displayList.measureBounds ?? []) {
    if (bound.isHidden || !bound.clefSign) continue;
    const index = staffByTop.get(bound.y) ?? nearestStaff(staves, bound.y + bound.height / 2, allStaffIndices);
    if (index === undefined) continue;
    const id = `p${bound.partIndex}/m${bound.index}/clef`;
    const candidates = clefXs[index]!.get(id) ?? [];
    const sp = staves[index]!.spatium;
    const matching = candidates.filter(
      (x) => x >= bound.x - 4 * sp && x <= bound.x + Math.max(bound.prefixWidth, 4 * sp),
    );
    const clefX =
      matching.length === 0
        ? bound.x
        : matching.reduce((best, x) => (Math.abs(x - bound.x) < Math.abs(best - bound.x) ? x : best));
    const sign = bound.clefSign;
    result[index]!.push({ x: clefX, sign });
    for (const change of bound.clefChanges ?? []) {
      result[index]!.push({ x: change.x, sign: change.sign });
    }
  }
  for (const contexts of result) contexts.sort((a, b) => a.x - b.x);
  return result;
}

export function activeStickyClefContext(
  contexts: readonly StickyClefContext[],
  contentX: number,
): KeyClefSign | undefined {
  if (contexts.length === 0) return undefined;
  let lo = 0;
  let hi = contexts.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (contexts[mid]!.x <= contentX) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? contexts[lo - 1]!.sign : undefined;
}

export function activeStickyKey(
  signatures: readonly StickyKeySignature[],
  contentX: number,
): StickyKeySignature | undefined {
  let lo = 0;
  let hi = signatures.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (signatures[mid]!.x <= contentX) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? signatures[lo - 1] : signatures[0]?.initial ? signatures[0] : undefined;
}

/** Width beyond the clef column, including the key's trailing clearance. */
export function stickyKeyWidth(
  signature: StickyKeySignature | undefined,
  staff: StaffInfo,
  railSpatium: number,
): number {
  const first = signature?.glyphs[0];
  const last = signature?.glyphs.at(-1);
  if (!first || !last) return 0;
  return KEY_GAP_SPATIA * railSpatium + last.x - first.x + ACCIDENTAL_ADVANCE_SPATIA * staff.spatium;
}

export function clefSignFromGlyph(codepoint: number): KeyClefSign {
  if (codepoint === 0xe069 || codepoint === 0xe06a) return "P";
  if (codepoint >= 0xe05c && codepoint <= 0xe061) return "C";
  if (codepoint >= 0xe062 && codepoint <= 0xe068) return "F";
  return "G";
}

const keyPositions = new Map<string, readonly number[]>();

function positionsForClef(signature: StickyKeySignature, sign: KeyClefSign): readonly number[] {
  if (sign === "P") return [];
  const count = signature.glyphs.length;
  const fifths = signature.glyphs[0]!.codepoint === SHARP ? count : -count;
  const cacheKey = `${sign}:${fifths}`;
  let positions = keyPositions.get(cacheKey);
  if (!positions) {
    positions = computeKeySignaturePositions(fifths, sign);
    keyPositions.set(cacheKey, positions);
  }
  return positions;
}

export function paintStickyKeySignature(
  ctx: CanvasRenderingContext2D,
  signature: StickyKeySignature | undefined,
  staff: StaffInfo,
  sign: KeyClefSign,
  sourceSign: KeyClefSign,
  keyX: number,
  railSpatium: number,
  snapContentPoint?: (x: number, y: number) => { x: number; y: number },
): void {
  const first = signature?.glyphs[0];
  if (!signature || !first || sign === "P") return;
  const positions = sign === sourceSign ? undefined : positionsForClef(signature, sign);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (let i = 0; i < signature.glyphs.length; i++) {
    const glyph = signature.glyphs[i]!;
    const x = keyX + KEY_GAP_SPATIA * railSpatium + glyph.x - first.x;
    const y = positions ? staff.y + positions[i]! * staff.spatium : glyph.y;
    const point = snapContentPoint ? snapContentPoint(x, y) : { x, y };
    ctx.fillStyle = glyph.color;
    ctx.font = `${glyph.size}px Bravura`;
    ctx.fillText(String.fromCodePoint(glyph.codepoint), point.x, point.y);
  }
}
