/**
 * Patch-frame decoder and reconstruction.
 *
 * The engine's incremental layout path emits a *patch frame* instead of a full
 * display list: only freshly-rendered systems are serialized, while unchanged
 * systems are referenced by their previous-frame index plus a vertical shift.
 * This file decodes that delta and reassembles a full {@link DisplayList} by
 * mirroring the engine-side `DisplayList::translate` and `DisplayList::append`
 * semantics exactly.
 *
 * Wire format (produced by `PatchFrame::to_binary` in
 * engine/viritura-engine/src/layout/cache.rs):
 * ```text
 * [version, width, height]
 * [num_pages] then per page: [page_number, num_systems, ...system_indices, y_offset, height]
 * [prefix_len]  ...prefix DisplayList::to_binary
 * [overlay_len] ...overlay DisplayList::to_binary
 * [num_placements] then per placement:
 *   Reuse v2: [0.0, prev_index, dy]
 *   Reuse v3: [0.0, prev_index, dx, dy]
 *   Fresh: [1.0, segment_len, ...segment DisplayList::to_binary]
 * ```
 *
 * The wasm entry point `apply_patch_and_layout_patch_frame_binary` prepends a
 * single frame-kind tag (`0.0` = full, `1.0` = patch); see {@link decodeFrame}.
 */

import { decodeBinaryDisplayList } from "./binaryDisplayList";
import { renderCommandBounds, type RenderBounds } from "./renderCommandBounds";
import type { DisplayList, PageLayout, RenderCommand, RetainedRenderLayer } from "./wasm";

const PLACEMENT_REUSE = 0.0;
const PLACEMENT_FRESH = 1.0;

const retainedLayerCache = new WeakMap<DisplayList, RetainedRenderLayer>();

function retainedRenderLayer(displayList: DisplayList): RetainedRenderLayer {
  const cached = retainedLayerCache.get(displayList);
  if (cached) return cached;

  let bounds: RenderBounds | null = null;
  const stateCommands: RetainedRenderLayer["stateCommands"] = [];
  for (const command of displayList.commands) {
    if (command.type === "SetOpacity") stateCommands.push(command);
    const commandBounds = renderCommandBounds(command);
    if (!commandBounds) continue;
    if (!bounds) {
      bounds = { ...commandBounds };
    } else {
      bounds.x = Math.min(bounds.x, commandBounds.x);
      bounds.y = Math.min(bounds.y, commandBounds.y);
      bounds.x2 = Math.max(bounds.x2, commandBounds.x2);
      bounds.y2 = Math.max(bounds.y2, commandBounds.y2);
    }
  }

  const layer = { displayList, bounds, stateCommands };
  retainedLayerCache.set(displayList, layer);
  return layer;
}

/** A unit in the reassembled system order. */
export type Placement =
  | { kind: "reuse"; prevIndex: number; dx: number; dy: number }
  | { kind: "fresh"; segment: DisplayList };

/** Decoded patch frame: the global header plus the ordered placements. */
export interface PatchFrame {
  width: number;
  height: number;
  /** Constant vertical offset applied to `prefix`, every `fresh` segment, and
   *  `overlay` at assembly (chunked-horizon galley headroom). `reuse` segments
   *  already carry it from when they were `fresh`. Paged layouts ship 0. */
  galleyOffsetY: number;
  pages: PageLayout[];
  prefix: DisplayList;
  overlay: DisplayList;
  placements: Placement[];
}

/** A decoded frame is either a full display list or an incremental patch. */
export type DecodedFrame = { kind: "full"; displayList: DisplayList } | { kind: "patch"; patch: PatchFrame };

/**
 * Shift every coordinate-bearing field of a {@link RenderCommand} in place.
 * Mirrors `RenderCommand::translate_in_place` in
 * engine/viritura-engine/src/render/command.rs.
 */
function translateCommandInPlace(cmd: RenderCommand, dx: number, dy: number): void {
  switch (cmd.type) {
    case "DrawEllipse":
    case "DrawCircle":
      cmd.cx += dx;
      cmd.cy += dy;
      break;
    case "DrawLine":
      cmd.x1 += dx;
      cmd.y1 += dy;
      cmd.x2 += dx;
      cmd.y2 += dy;
      break;
    case "DrawBezier":
      cmd.x1 += dx;
      cmd.y1 += dy;
      cmd.cx1 += dx;
      cmd.cy1 += dy;
      cmd.cx2 += dx;
      cmd.cy2 += dy;
      cmd.x2 += dx;
      cmd.y2 += dy;
      break;
    case "DrawQuadratic":
      cmd.x1 += dx;
      cmd.y1 += dy;
      cmd.cx += dx;
      cmd.cy += dy;
      cmd.x2 += dx;
      cmd.y2 += dy;
      break;
    case "DrawRect":
      cmd.x += dx;
      cmd.y += dy;
      break;
    case "DrawText":
    case "DrawGlyph":
    case "DrawStretchedGlyph":
      cmd.x += dx;
      cmd.y += dy;
      break;
    case "DrawPolygon":
      for (const point of cmd.points) {
        point[0] += dx;
        point[1] += dy;
      }
      break;
    case "DrawFilledBezier":
      cmd.x1 += dx;
      cmd.y1 += dy;
      cmd.x2 += dx;
      cmd.y2 += dy;
      cmd.ocx1 += dx;
      cmd.ocy1 += dy;
      cmd.ocx2 += dx;
      cmd.ocy2 += dy;
      cmd.icx1 += dx;
      cmd.icy1 += dy;
      cmd.icx2 += dx;
      cmd.icy2 += dy;
      cmd.ix1 += dx;
      cmd.iy1 += dy;
      cmd.ix2 += dx;
      cmd.iy2 += dy;
      break;
    case "SetOpacity":
      break;
  }
}

/**
 * Shift every coordinate-bearing store of a per-system segment in place.
 * Mirrors `DisplayList::translate` (minus `pages`/`layout_debug`/`element_shapes`,
 * which segments never carry over the binary protocol).
 */
function translateSegmentInPlace(dl: DisplayList, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const cmd of dl.commands) translateCommandInPlace(cmd, dx, dy);
  if (dl.elementBboxes) {
    for (const eb of dl.elementBboxes) {
      eb.bbox.x += dx;
      eb.bbox.y += dy;
    }
  }
  if (dl.slurGeometries) {
    for (const sg of dl.slurGeometries) {
      sg.p0x += dx;
      sg.p0y += dy;
      sg.p1x += dx;
      sg.p1y += dy;
      sg.p2x += dx;
      sg.p2y += dy;
      sg.p3x += dx;
      sg.p3y += dy;
    }
  }
  if (dl.measureBounds) {
    for (const mb of dl.measureBounds) {
      mb.x += dx;
      mb.y += dy;
      for (const anchor of mb.beatAnchors) anchor[1] += dx;
    }
  }
  const retainedLayer = retainedLayerCache.get(dl);
  if (retainedLayer?.bounds) {
    retainedLayer.bounds.x += dx;
    retainedLayer.bounds.y += dy;
    retainedLayer.bounds.x2 += dx;
    retainedLayer.bounds.y2 += dy;
  }
}

/**
 * Append `other`'s content stores onto `target`, mirroring
 * `DisplayList::append`. `element_shapes` are absent over the binary protocol,
 * so the only non-trivial fix-up is keeping `elementIds` index-aligned with
 * `commands` when either side carries tags.
 *
 * Performance: the previous implementation `.slice()`d both `targetIds` and
 * `otherIds` on every call, an O(N×P) walk over a P-placement frame's
 * accumulated IDs (~140 ms on Rhapsody's 286-placement frames). The current
 * version mutates `target.elementIds` in place — the slice was never needed,
 * since `target` is freshly allocated by `applyPatch` and we own it.
 */
function appendSegment(target: DisplayList, other: DisplayList): void {
  const cmdBase = target.commands.length;
  // Bulk-push commands. Spread is faster than a per-cmd push loop for
  // medium-large arrays and avoids the function-call-per-element overhead.
  if (other.commands.length > 0) {
    target.commands.push(...other.commands);
  }
  const appended = target.commands.length - cmdBase;

  const otherIds = other.elementIds;
  const otherHasIds = otherIds !== undefined && otherIds.length > 0;
  if (target.elementIds !== undefined || otherHasIds) {
    // Lazily materialize target.elementIds on first need (matches the
    // previous semantics: empty target stays untagged unless something is
    // appended with tags). Once created, mutate in place — no slice.
    const ids = (target.elementIds ??= []);
    // Pad target up to cmdBase with nulls so the index alignment with
    // `target.commands` holds (a previous append may have left it short if
    // `other` carried no IDs).
    while (ids.length < cmdBase) ids.push(null);
    if (otherHasIds) {
      // Other carries IDs: append them and pad any tail (other.commands
      // longer than other.elementIds — defensive; engine should keep them
      // aligned).
      for (const id of otherIds!) ids.push(id);
      while (ids.length < cmdBase + appended) ids.push(null);
    } else {
      // Other carried commands but no IDs — pad nulls to keep alignment.
      for (let i = 0; i < appended; i++) ids.push(null);
    }
  }

  if (other.elementBboxes && other.elementBboxes.length > 0) {
    (target.elementBboxes ??= []).push(...other.elementBboxes);
  }
  if (other.slurGeometries && other.slurGeometries.length > 0) {
    (target.slurGeometries ??= []).push(...other.slurGeometries);
  }
  if (other.measureBounds && other.measureBounds.length > 0) {
    (target.measureBounds ??= []).push(...other.measureBounds);
  }
}

/**
 * Decode the tagged frame returned by `apply_patch_and_layout_patch_frame_binary`.
 * Element 0 selects the variant: `0.0` → full display list, `1.0` → patch frame.
 */
export function decodeFrame(data: Float32Array): DecodedFrame {
  const tag = data[0];
  const body = data.subarray(1);
  if (tag === 0.0) {
    return { kind: "full", displayList: decodeBinaryDisplayList(body) };
  }
  return { kind: "patch", patch: decodePatchFrame(body) };
}

/** Decode the patch-frame body (after the frame-kind tag has been consumed). */
export function decodePatchFrame(data: Float32Array): PatchFrame {
  let pos = 0;
  const next = (): number => data[pos++]!;

  const version = next();
  if (version !== 2.0 && version !== 3.0) {
    throw new Error(`Unsupported patch-frame version: ${version}`);
  }
  const width = next();
  const height = next();
  const galleyOffsetY = next();

  const numPages = next();
  const pages: PageLayout[] = [];
  for (let p = 0; p < numPages; p++) {
    const pageNumber = next();
    const numSystems = next();
    const systemIndices: number[] = [];
    for (let s = 0; s < numSystems; s++) systemIndices.push(next());
    const yOffset = next();
    const pageHeight = next();
    pages.push({ pageNumber, systemIndices, yOffset, height: pageHeight });
  }

  const readBlob = (): DisplayList => {
    const len = next();
    const blob = data.subarray(pos, pos + len);
    pos += len;
    return decodeBinaryDisplayList(blob);
  };

  const prefix = readBlob();
  const overlay = readBlob();

  const numPlacements = next();
  const placements: Placement[] = [];
  for (let i = 0; i < numPlacements; i++) {
    const kind = next();
    if (kind === PLACEMENT_REUSE) {
      const prevIndex = next();
      const dx = version >= 3.0 ? next() : 0;
      const dy = next();
      placements.push({ kind: "reuse", prevIndex, dx, dy });
    } else if (kind === PLACEMENT_FRESH) {
      placements.push({ kind: "fresh", segment: readBlob() });
    } else {
      throw new Error(`Unknown patch placement tag: ${kind} at offset ${pos - 1}`);
    }
  }

  return { width, height, galleyOffsetY, pages, prefix, overlay, placements };
}

/**
 * Reassembles a full {@link DisplayList} from successive patch frames, holding
 * the previous frame's per-system segments so reused systems can be shifted and
 * re-emitted without the engine re-serializing them.
 *
 * The engine reports a reused system's `dy` relative to that segment's
 * *original* render position (the frame in which it was last Fresh). Rather than
 * carry each segment forward untranslated and deep-clone + re-translate it every
 * frame — which costs more than decoding the whole list — this reconstructor
 * keeps each segment at its **currently shown** position and tracks that offset,
 * applying only the incremental delta `dy - shownDy` in place. For a typical
 * single-note edit no system moves vertically (`dy === 0`), so reused systems
 * are appended by reference at zero copy cost.
 *
 * The assembled list shares the live segment objects, so a consumer must finish
 * with one frame before requesting the next (the editor discards the previous
 * display list on each layout, so this holds).
 */
export class PatchReconstructor {
  private prevSegments: DisplayList[] = [];
  /** Retained flattened compatibility view. Shape-stable patches mutate only
   * fresh/global ranges; reused segment objects stay shared in these arrays. */
  private assembled: DisplayList | null = null;
  private prefixShape: StoreShape | null = null;
  private overlayShape: StoreShape | null = null;
  /** Each retained segment's current horizontal offset from its Fresh position. */
  private shownDx: number[] = [];
  /** Each retained segment's current vertical offset from its original (Fresh) position. */
  private shownDy: number[] = [];

  /**
   * Drop the retained per-system segments. Call when the engine's recorded
   * system order is reset out-of-band (full layout / cache invalidation), so
   * the next patch frame is treated as a clean re-seed.
   */
  reset(): void {
    this.prevSegments = [];
    this.assembled = null;
    this.prefixShape = null;
    this.overlayShape = null;
    this.shownDx = [];
    this.shownDy = [];
  }

  /** Apply a decoded frame, returning the assembled full display list. */
  apply(frame: DecodedFrame, deferFlatten = false): DisplayList {
    if (frame.kind === "full") {
      // A full frame carries no per-system segmentation, so the retained list
      // is reset; the next patch frame will be all-Fresh and rebuild it.
      this.reset();
      return frame.displayList;
    }
    return this.applyPatch(frame.patch, deferFlatten);
  }

  private applyPatch(patch: PatchFrame, deferFlatten: boolean): DisplayList {
    const off = patch.galleyOffsetY;
    // Prefix carries the constant galley headroom (chunked horizon). The
    // decoded frame is single-use (re-decoded every edit; only per-system
    // segments are retained), so translate in place.
    if (off !== 0) translateSegmentInPlace(patch.prefix, 0, off);
    const nextSegments: DisplayList[] = [];
    const nextDx: number[] = [];
    const nextDy: number[] = [];
    let canUpdateInPlace = this.assembled !== null && patch.placements.length === this.prevSegments.length;
    for (let placementIndex = 0; placementIndex < patch.placements.length; placementIndex++) {
      const placement = patch.placements[placementIndex]!;
      if (placement.kind === "reuse") {
        const segment = this.prevSegments[placement.prevIndex];
        if (!segment) {
          throw new Error(`Patch reuse references missing segment ${placement.prevIndex}`);
        }
        const currentDx = this.shownDx[placement.prevIndex] ?? 0;
        const currentDy = this.shownDy[placement.prevIndex] ?? 0;
        const deltaX = placement.dx - currentDx;
        const deltaY = placement.dy - currentDy;
        if (deltaX !== 0 || deltaY !== 0) translateSegmentInPlace(segment, deltaX, deltaY);
        // An in-place flattened view can retain a reused range only when its
        // ordinal is unchanged. Reordering is uncommon (membership changes)
        // and safely falls back to a full compatibility rebuild.
        if (placement.prevIndex !== placementIndex) canUpdateInPlace = false;
        nextSegments.push(segment);
        nextDx.push(placement.dx);
        nextDy.push(placement.dy);
      } else {
        // Fresh segments are decoded at their PRE-offset position. Apply the
        // constant galley headroom once, in place, then both append it and
        // carry the OFFSET segment forward so a later reuse stays consistent.
        if (off !== 0) translateSegmentInPlace(placement.segment, 0, off);
        nextSegments.push(placement.segment);
        nextDx.push(0);
        nextDy.push(0);
      }
    }

    if (off !== 0) translateSegmentInPlace(patch.overlay, 0, off);
    const pages =
      patch.pages.length > 0
        ? off !== 0
          ? patch.pages.map((p) => ({ ...p, yOffset: p.yOffset + off }))
          : patch.pages
        : undefined;

    const previousSegments = this.prevSegments;
    const previousPrefixShape = this.prefixShape;
    const previousOverlayShape = this.overlayShape;
    const assembled = this.assembled ?? { commands: [], width: patch.width, height: patch.height };
    const finalizeFlattenedStores = (): void => {
      if (
        canUpdateInPlace &&
        sameStoreShapeAtRanges(
          patch.prefix,
          nextSegments,
          patch.overlay,
          assembled,
          previousSegments,
          previousPrefixShape,
          previousOverlayShape,
        )
      ) {
        updateFlattenedStoresInPlace(assembled, patch.prefix, patch.placements, nextSegments, patch.overlay);
      } else {
        const rebuilt: DisplayList = { commands: [], width: patch.width, height: patch.height };
        appendSegment(rebuilt, patch.prefix);
        for (const segment of nextSegments) appendSegment(rebuilt, segment);
        appendSegment(rebuilt, patch.overlay);
        assembled.commands = rebuilt.commands;
        assembled.elementIds = rebuilt.elementIds;
        assembled.elementBboxes = rebuilt.elementBboxes;
        assembled.slurGeometries = rebuilt.slurGeometries;
        assembled.measureBounds = rebuilt.measureBounds;
      }
      assembled.width = patch.width;
      assembled.height = patch.height;
      assembled.pages = pages;
      delete assembled.finalizeRetainedFrame;
      this.prefixShape = storeShape(patch.prefix);
      this.overlayShape = storeShape(patch.overlay);
    };

    assembled.width = patch.width;
    assembled.height = patch.height;
    assembled.pages = pages;
    if (deferFlatten && this.assembled) {
      Object.defineProperty(assembled, "finalizeRetainedFrame", {
        value: finalizeFlattenedStores,
        configurable: true,
        writable: true,
        enumerable: false,
      });
    } else {
      finalizeFlattenedStores();
    }

    this.prevSegments = nextSegments;
    this.assembled = assembled;
    this.shownDx = nextDx;
    this.shownDy = nextDy;
    Object.defineProperty(assembled, "retainedRenderLayers", {
      value: [
        retainedRenderLayer(patch.prefix),
        ...nextSegments.map(retainedRenderLayer),
        retainedRenderLayer(patch.overlay),
      ],
      configurable: true,
      writable: true,
      enumerable: false,
    });
    return assembled;
  }
}

interface StoreShape {
  commands: number;
  bboxes: number;
  slurs: number;
  measures: number;
}

function storeShape(displayList: DisplayList): StoreShape {
  return {
    commands: displayList.commands.length,
    bboxes: displayList.elementBboxes?.length ?? 0,
    slurs: displayList.slurGeometries?.length ?? 0,
    measures: displayList.measureBounds?.length ?? 0,
  };
}

function equalStoreShape(left: DisplayList, right: DisplayList): boolean {
  const a = storeShape(left);
  const b = storeShape(right);
  return a.commands === b.commands && a.bboxes === b.bboxes && a.slurs === b.slurs && a.measures === b.measures;
}

function sameStoreShapeAtRanges(
  prefix: DisplayList,
  nextSegments: readonly DisplayList[],
  overlay: DisplayList,
  assembled: DisplayList,
  previousSegments: readonly DisplayList[],
  previousPrefixShape: StoreShape | null,
  previousOverlayShape: StoreShape | null,
): boolean {
  if (!previousPrefixShape || !previousOverlayShape) return false;
  const prefixShape = storeShape(prefix);
  const overlayShape = storeShape(overlay);
  if (
    prefixShape.commands !== previousPrefixShape.commands ||
    prefixShape.bboxes !== previousPrefixShape.bboxes ||
    prefixShape.slurs !== previousPrefixShape.slurs ||
    prefixShape.measures !== previousPrefixShape.measures ||
    overlayShape.commands !== previousOverlayShape.commands ||
    overlayShape.bboxes !== previousOverlayShape.bboxes ||
    overlayShape.slurs !== previousOverlayShape.slurs ||
    overlayShape.measures !== previousOverlayShape.measures
  ) {
    return false;
  }
  if (nextSegments.length !== previousSegments.length) return false;
  if (!nextSegments.every((segment, index) => equalStoreShape(segment, previousSegments[index]!))) return false;
  const expected = [prefix, ...nextSegments, overlay].reduce(
    (sum, displayList) => {
      const shape = storeShape(displayList);
      sum.commands += shape.commands;
      sum.bboxes += shape.bboxes;
      sum.slurs += shape.slurs;
      sum.measures += shape.measures;
      return sum;
    },
    { commands: 0, bboxes: 0, slurs: 0, measures: 0 },
  );
  return (
    assembled.commands.length === expected.commands &&
    (assembled.elementBboxes?.length ?? 0) === expected.bboxes &&
    (assembled.slurGeometries?.length ?? 0) === expected.slurs &&
    (assembled.measureBounds?.length ?? 0) === expected.measures
  );
}

interface StoreOffsets {
  commands: number;
  bboxes: number;
  slurs: number;
  measures: number;
}

function advanceOffsets(offsets: StoreOffsets, displayList: DisplayList): void {
  const shape = storeShape(displayList);
  offsets.commands += shape.commands;
  offsets.bboxes += shape.bboxes;
  offsets.slurs += shape.slurs;
  offsets.measures += shape.measures;
}

function normalizedIds(displayList: DisplayList): Array<string | null> {
  if (!displayList.elementIds?.length) return Array.from({ length: displayList.commands.length }, () => null);
  const ids = displayList.elementIds.slice(0, displayList.commands.length);
  while (ids.length < displayList.commands.length) ids.push(null);
  return ids;
}

function replaceStoresAt(target: DisplayList, source: DisplayList, offsets: StoreOffsets): void {
  const shape = storeShape(source);
  target.commands.splice(offsets.commands, shape.commands, ...source.commands);
  if (target.elementIds) {
    target.elementIds.splice(offsets.commands, shape.commands, ...normalizedIds(source));
  }
  if (shape.bboxes > 0) {
    target.elementBboxes!.splice(offsets.bboxes, shape.bboxes, ...source.elementBboxes!);
  }
  if (shape.slurs > 0) {
    target.slurGeometries!.splice(offsets.slurs, shape.slurs, ...source.slurGeometries!);
  }
  if (shape.measures > 0) {
    target.measureBounds!.splice(offsets.measures, shape.measures, ...source.measureBounds!);
  }
}

function updateFlattenedStoresInPlace(
  target: DisplayList,
  prefix: DisplayList,
  placements: readonly Placement[],
  segments: readonly DisplayList[],
  overlay: DisplayList,
): void {
  const offsets: StoreOffsets = { commands: 0, bboxes: 0, slurs: 0, measures: 0 };
  replaceStoresAt(target, prefix, offsets);
  advanceOffsets(offsets, prefix);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (placements[index]?.kind === "fresh") replaceStoresAt(target, segment, offsets);
    advanceOffsets(offsets, segment);
  }
  replaceStoresAt(target, overlay, offsets);
}
