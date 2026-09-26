import { wasmExportSvg, type DisplayList as RendererDisplayList } from "@viritura/renderer";
import { pageLayoutsOf } from "./displayListHandle";
import { displayListWithInk } from "./paint";
import type { SvgOptions } from "./types";

/** Display-list units are CSS pixels: 96 per inch. */
const MM_PER_UNIT = 25.4 / 96;

const fontBytes = new Map<string, Promise<Uint8Array>>();

function fetchFont(url: string): Promise<Uint8Array> {
  let bytes = fontBytes.get(url);
  if (!bytes) {
    bytes = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`Failed to fetch font ${url}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    });
    // Let a failed fetch be retried.
    bytes.catch(() => fontBytes.delete(url));
    fontBytes.set(url, bytes);
  }
  return bytes;
}

/**
 * Export one page as standalone SVG. Glyphs and text are converted to path
 * outlines, so the result needs no fonts.
 */
export async function exportPageSvg(
  displayList: RendererDisplayList,
  assetBase: string,
  opts: SvgOptions,
): Promise<string> {
  const pageIndex = opts.page ?? 0;
  const pages = pageLayoutsOf(displayList);
  const page = pages[pageIndex];
  if (!page) throw new RangeError(`Page ${pageIndex} out of range (0-${pages.length - 1})`);
  const [bravura, text] = await Promise.all([
    fetchFont(`${assetBase}fonts/Bravura.otf`),
    fetchFont(`${assetBase}fonts/LibertinusSerif-Regular.otf`),
  ]);
  const source = displayListWithInk(displayList, opts.ink);
  const svgPages = wasmExportSvg(
    JSON.stringify(source),
    bravura,
    text,
    MM_PER_UNIT,
    1,
    displayList.width * MM_PER_UNIT,
    page.height * MM_PER_UNIT,
  );
  const svg = svgPages[pageIndex]?.svg;
  if (svg === undefined) throw new RangeError(`Page ${pageIndex} was not exported`);
  return svg;
}
