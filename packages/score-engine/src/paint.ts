/**
 * Ink-only Canvas painting for public display lists.
 *
 * `paint` never clears or scales the canvas: callers own the context
 * transform (device-pixel ratio, zoom, scroll) and any page presentation.
 */

import {
  paintCommandsCulled,
  splitCommandsByPage,
  type DisplayList as RendererDisplayList,
  type PageLayout,
  type RenderCommand,
} from "@viritura/renderer";
import type { PaintOptions } from "./types";

interface PageSlice {
  readonly commands: RenderCommand[];
  readonly layout: PageLayout;
}

const pageSlices = new WeakMap<RendererDisplayList, PageSlice[]>();
const recoloured = new WeakMap<readonly RenderCommand[], Map<string, RenderCommand[]>>();

const DEFAULT_INK = /^#0{3}(?:0{3})?$/i;

/** Commands of one page, split once per display list. */
function pageSlice(displayList: RendererDisplayList, page: number): PageSlice | undefined {
  let slices = pageSlices.get(displayList);
  if (!slices) {
    slices = splitCommandsByPage(displayList);
    pageSlices.set(displayList, slices);
  }
  return slices[page];
}

/** Substitute `ink` for default black ink, keeping explicitly coloured elements. */
export function withInk(commands: RenderCommand[], ink: string | undefined): RenderCommand[] {
  if (!ink) return commands;
  let byInk = recoloured.get(commands);
  if (!byInk) {
    byInk = new Map();
    recoloured.set(commands, byInk);
  }
  const cached = byInk.get(ink);
  if (cached) return cached;
  const result = commands.map((cmd) =>
    "color" in cmd && typeof cmd.color === "string" && DEFAULT_INK.test(cmd.color) ? { ...cmd, color: ink } : cmd,
  ) as RenderCommand[];
  byInk.set(ink, result);
  return result;
}

/** Recolour a whole display list (used for SVG export). */
export function displayListWithInk(displayList: RendererDisplayList, ink: string | undefined): RendererDisplayList {
  if (!ink) return displayList;
  return { ...displayList, commands: withInk(displayList.commands, ink) };
}

export function paintInk(ctx: CanvasRenderingContext2D, displayList: RendererDisplayList, opts: PaintOptions): void {
  const slice = pageSlice(displayList, opts.page ?? 0);
  if (!slice) return;
  const width = displayList.width;
  const height = slice.layout.height;
  const region = opts.region ?? { x: 0, y: 0, width, height };
  ctx.save();
  ctx.beginPath();
  ctx.rect(region.x, region.y, region.width, region.height);
  ctx.clip();
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(region.x, region.y, region.width, region.height);
  }
  // Commands are in absolute (stacked-page) coordinates; shift the page to
  // the origin so geometry and painting agree on page-local space.
  const offsetY = slice.layout.yOffset;
  ctx.translate(0, -offsetY);
  paintCommandsCulled(
    ctx,
    withInk(slice.commands, opts.ink),
    null,
    region.x,
    region.x + region.width,
    region.y + offsetY,
    region.y + offsetY + region.height,
  );
  ctx.restore();
}
