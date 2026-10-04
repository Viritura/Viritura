/**
 * Binary Display List decoder and painter.
 *
 * Reads a packed Float32Array produced by the Rust engine's `to_binary()` method
 * and either decodes it into a DisplayList object or paints directly to a Canvas 2D
 * context (for maximum performance).
 *
 * Binary format documentation: see engine/viritura-engine/src/render/binary.rs
 *
 * Per-tag decode/paint routines live in `./binaryDisplayListCommands` so this
 * file's top-level entry points stay within complexity/length budgets.
 */

import type {
  DisplayList,
  PageLayout,
  RenderCommand,
  ElementBBox,
  BoundingBox,
  SlurGeometry,
  MeasureBounds,
  SelectionGroup,
  PartSummary,
} from "./wasm";
import { BinaryReader, DECODERS, PAINTERS } from "./binaryDisplayListCommands";
import { paintDisplayList } from "./displayListPainter";

function readPages(r: BinaryReader, numPages: number): PageLayout[] {
  const pages: PageLayout[] = [];
  for (let p = 0; p < numPages; p++) {
    const pageNumber = r.f32();
    const numSystems = r.f32();
    const systemIndices: number[] = [];
    for (let s = 0; s < numSystems; s++) {
      systemIndices.push(r.f32());
    }
    const yOffset = r.f32();
    const height = r.f32();
    pages.push({ pageNumber, systemIndices, yOffset, height });
  }
  return pages;
}

function readElementBboxes(r: BinaryReader, numBboxes: number): ElementBBox[] {
  const bboxes: ElementBBox[] = [];
  for (let i = 0; i < numBboxes; i++) {
    const idLen = r.f32();
    let elementId = "";
    for (let j = 0; j < idLen; j++) {
      elementId += String.fromCodePoint(r.f32());
    }
    const bbox: BoundingBox = {
      x: r.f32(),
      y: r.f32(),
      width: r.f32(),
      height: r.f32(),
    };
    bboxes.push({ elementId, bbox });
  }
  return bboxes;
}

function readSlurGeometries(r: BinaryReader, n: number): SlurGeometry[] {
  const out: SlurGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const idLen = r.f32();
    let elementId = "";
    for (let j = 0; j < idLen; j++) {
      elementId += String.fromCodePoint(r.f32());
    }
    out.push({
      elementId,
      p0x: r.f32(),
      p0y: r.f32(),
      p1x: r.f32(),
      p1y: r.f32(),
      p2x: r.f32(),
      p2y: r.f32(),
      p3x: r.f32(),
      p3y: r.f32(),
      thickness: r.f32(),
      curveDir: r.f32(),
      sp: r.f32(),
    });
  }
  return out;
}

function readCodepointString(r: BinaryReader, len: number): string {
  let value = "";
  for (let i = 0; i < len; i++) {
    value += String.fromCodePoint(r.f32());
  }
  return value;
}

function readMeasureBounds(r: BinaryReader, n: number): MeasureBounds[] {
  const out: MeasureBounds[] = [];
  for (let i = 0; i < n; i++) {
    const idLen = r.f32();
    const measureId = idLen >= 0 ? readCodepointString(r, idLen) : undefined;
    const index = r.f32();
    const partIndex = r.f32();
    const staffIndex = r.f32();
    const systemIndex = r.f32();
    const x = r.f32();
    const width = r.f32();
    const y = r.f32();
    const height = r.f32();
    const prefixWidth = r.f32();
    const totalBeats = r.f32();
    const beatAnchorCount = r.f32();
    const beatAnchors: [number, number][] = [];
    for (let j = 0; j < beatAnchorCount; j++) {
      beatAnchors.push([r.f32(), r.f32()]);
    }

    const ghostStaff = r.f32() !== 0;
    const isHidden = r.f32() !== 0;
    const hasMusicHidden = r.f32() !== 0;
    const isExpansion = r.f32() !== 0;
    out.push({
      index,
      ...(measureId !== undefined ? { measureId } : {}),
      partIndex,
      partId: `#${partIndex}`,
      staffIndex,
      systemIndex,
      x,
      width,
      y,
      height,
      prefixWidth,
      totalBeats,
      beatAnchors,
      ...(ghostStaff ? { ghostStaff } : {}),
      ...(isHidden ? { isHidden } : {}),
      ...(hasMusicHidden ? { hasMusicHidden } : {}),
      ...(isExpansion ? { isExpansion } : {}),
    });
  }
  return out;
}

function readSelectionGroups(r: BinaryReader, count: number): SelectionGroup[] {
  const groups: SelectionGroup[] = [];
  for (let index = 0; index < count; index++) {
    const elementId = readCodepointString(r, r.f32());
    const memberCount = r.f32();
    const memberIds: string[] = [];
    for (let member = 0; member < memberCount; member++) {
      memberIds.push(readCodepointString(r, r.f32()));
    }
    groups.push({ elementId, memberIds });
  }
  return groups;
}

function readElementIds(r: BinaryReader, numCommands: number, numStrings: number): (string | null)[] | undefined {
  if (numStrings === 0) {
    // Skip per-command indices (all -1.0)
    r.skip(numCommands);
    return undefined;
  }
  const stringTable: string[] = [];
  for (let s = 0; s < numStrings; s++) {
    const charCount = r.f32();
    let str = "";
    for (let i = 0; i < charCount; i++) {
      str += String.fromCodePoint(r.f32());
    }
    stringTable.push(str);
  }
  const ids: (string | null)[] = [];
  for (let c = 0; c < numCommands; c++) {
    const idx = r.f32();
    ids.push(idx < 0 ? null : (stringTable[idx] ?? null));
  }
  return ids;
}

/**
 * Decode a binary Float32Array into a DisplayList object.
 * Use this when you need the structured data (e.g., for testing or JSON fallback).
 */
export function decodeBinaryDisplayList(data: Float32Array): DisplayList {
  const r = new BinaryReader(data);

  const width = r.f32();
  const height = r.f32();
  const numCommands = r.f32();
  const numPages = r.f32();
  const numStrings = r.f32();
  const numBboxes = r.f32();
  const numSlurGeometries = r.f32();

  const pages = readPages(r, numPages);
  const elementBboxes = readElementBboxes(r, numBboxes);
  const slurGeometries = readSlurGeometries(r, numSlurGeometries);

  const commands: RenderCommand[] = [];
  for (let c = 0; c < numCommands; c++) {
    const tag = r.f32();
    const decoder = DECODERS[tag];
    if (!decoder) {
      throw new Error(`Unknown binary display list command tag: ${tag} at offset ${r.pos - 1}`);
    }
    commands.push(decoder(r));
  }

  const elementIds = readElementIds(r, numCommands, numStrings);
  const measureBounds = r.pos < data.length ? readMeasureBounds(r, r.f32()) : [];
  const selectionGroups = r.pos < data.length ? readSelectionGroups(r, r.f32()) : [];
  const parts: PartSummary[] = [];
  if (r.pos < data.length) {
    const entryCount = r.f32();
    for (let i = 0; i < entryCount; i++) {
      const boundsIndex = r.f32();
      const sourceCount = r.f32();
      const sources: number[] = [];
      for (let j = 0; j < sourceCount; j++) sources.push(r.f32());
      const bounds = measureBounds[boundsIndex];
      if (bounds && sources.length > 0) bounds.sourcePartIndices = sources;
    }
  }
  if (r.pos < data.length) {
    const count = r.f32();
    for (let i = 0; i < count; i++) {
      parts.push({
        index: r.f32(),
        id: readCodepointString(r, r.f32()),
        name: readCodepointString(r, r.f32()),
      });
    }
    const boundsCount = r.f32();
    for (let i = 0; i < boundsCount; i++) {
      const id = readCodepointString(r, r.f32());
      const bounds = measureBounds[i];
      if (bounds) bounds.partId = id;
    }
  }

  const result: DisplayList = { commands, width, height };
  if (pages.length > 0) result.pages = pages;
  if (elementIds) result.elementIds = elementIds;
  if (elementBboxes.length > 0) result.elementBboxes = elementBboxes;
  if (slurGeometries.length > 0) result.slurGeometries = slurGeometries;
  if (measureBounds.length > 0) result.measureBounds = measureBounds;
  if (parts.length > 0) result.parts = parts;
  if (selectionGroups.length > 0) result.selectionGroups = selectionGroups;
  return result;
}

function skipPaintHeaderTables(r: BinaryReader, numPages: number, numBboxes: number, numSlurGeometries: number): void {
  // Skip page data
  for (let p = 0; p < numPages; p++) {
    r.skip(1); // page_number
    const numSystems = r.f32();
    r.skip(numSystems); // system_indices
    r.skip(2); // y_offset, height
  }
  // Skip element bbox data
  for (let i = 0; i < numBboxes; i++) {
    const idLen = r.f32();
    r.skip(idLen); // id codepoints
    r.skip(4); // x, y, width, height
  }
  // Skip slur geometry data
  for (let i = 0; i < numSlurGeometries; i++) {
    const idLen = r.f32();
    r.skip(idLen); // id codepoints
    r.skip(11); // p0..p3 (8) + thickness + curveDir + sp
  }
}

/**
 * Paint a binary display list directly to a Canvas 2D context.
 * This is the fastest path — no intermediate object allocation.
 */
export function paintBinaryDisplayList(ctx: CanvasRenderingContext2D, data: Float32Array): void {
  // Ordered knockouts need look-ahead; retain the allocation-free path for ordinary scores.
  if (binaryHasEraseRect(data)) {
    paintDisplayList(ctx, decodeBinaryDisplayList(data));
    return;
  }
  const r = new BinaryReader(data);

  const width = r.f32();
  const height = r.f32();
  const numCommands = r.f32();
  const numPages = r.f32();
  r.skip(1); // num_strings (not needed for painting)
  const numBboxes = r.f32();
  const numSlurGeometries = r.f32();

  skipPaintHeaderTables(r, numPages, numBboxes, numSlurGeometries);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);

  for (let c = 0; c < numCommands; c++) {
    const tag = r.f32();
    const painter = PAINTERS[tag];
    if (!painter) {
      throw new Error(`Unknown binary command tag: ${tag}`);
    }

    painter(ctx, r);
  }
}

const FIXED_COMMAND_SIZES: Record<number, number> = { 1: 6, 2: 5, 3: 4, 4: 7, 5: 7, 6: 10, 7: 8, 8: 18, 11: 1, 12: 7 };

function binaryHasEraseRect(data: Float32Array): boolean {
  const r = new BinaryReader(data);
  r.skip(2);
  const commandCount = r.f32();
  const pageCount = r.f32();
  r.skip(1);
  const bboxCount = r.f32();
  const slurCount = r.f32();
  skipPaintHeaderTables(r, pageCount, bboxCount, slurCount);
  for (let index = 0; index < commandCount; index++) {
    const tag = r.f32();
    if (tag === 13) return true;
    if (tag === 9) {
      const points = r.f32();
      r.skip(points * 2 + 1);
    } else if (tag === 10) {
      r.skip(7);
      r.skip(r.f32());
    } else {
      const count = FIXED_COMMAND_SIZES[tag];
      if (count === undefined) throw new Error(`Unknown binary command tag: ${tag}`);
      r.skip(count);
    }
  }
  return false;
}

/**
 * Extract just the width and height from a binary display list header.
 * Useful for canvas sizing without full decode.
 */
export function getBinaryDisplayListDimensions(data: Float32Array): {
  width: number;
  height: number;
} {
  const r = new BinaryReader(data);
  return { width: r.f32(), height: r.f32() };
}

/**
 * Extract page layout information from a binary display list.
 */
export function getBinaryDisplayListPages(data: Float32Array): PageLayout[] {
  const r = new BinaryReader(data);
  r.skip(3); // width, height, numCommands
  const numPages = r.f32();
  r.skip(3); // num_strings, numBboxes, numSlurGeometries
  return readPages(r, numPages);
}

/**
 * Extract element bounding boxes from a binary display list.
 */
export function getBinaryDisplayListBboxes(data: Float32Array): ElementBBox[] {
  const r = new BinaryReader(data);
  r.skip(3); // width, height, numCommands
  const numPages = r.f32();
  r.skip(1); // numStrings
  const numBboxes = r.f32();
  r.skip(1); // numSlurGeometries

  // Skip page data
  for (let p = 0; p < numPages; p++) {
    r.skip(1); // page_number
    const numSystems = r.f32();
    r.skip(numSystems); // system_indices
    r.skip(2); // y_offset, height
  }

  return readElementBboxes(r, numBboxes);
}
