/**
 * Opaque public display-list handles.
 *
 * Consumers only ever see `DisplayList` handles; the renderer's full display
 * list stays behind a WeakMap so its shape is not part of the public API.
 */

import type { DisplayList as RendererDisplayList, PageLayout } from "@viritura/renderer";
import type { DisplayList } from "./types";

const internals = new WeakMap<DisplayList, RendererDisplayList>();

/** Page layouts of a renderer display list; unpaged layouts form one page. */
export function pageLayoutsOf(displayList: RendererDisplayList): readonly PageLayout[] {
  if (displayList.pages?.length) return displayList.pages;
  return [{ pageNumber: 1, systemIndices: [], yOffset: 0, height: displayList.height }];
}

/** Wrap a renderer display list in a frozen public handle. */
export function wrapDisplayList(displayList: RendererDisplayList): DisplayList {
  const handle = Object.freeze({
    width: displayList.width,
    height: displayList.height,
    pageCount: pageLayoutsOf(displayList).length,
    paged: Boolean(displayList.pages?.length),
  }) as unknown as DisplayList;
  internals.set(handle, displayList);
  return handle;
}

/** Resolve a public handle back to the renderer display list. */
export function unwrapDisplayList(handle: DisplayList): RendererDisplayList {
  const displayList = internals.get(handle);
  if (!displayList) {
    throw new TypeError("DisplayList was not produced by this score engine.");
  }
  return displayList;
}
