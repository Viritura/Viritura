/**
 * Keeping the filmstrip filled as the composer moves around.
 *
 * Separated from `TimelineCanvas` because it is genuinely a different concern —
 * an async, cache-backed side effect keyed on the viewport — and because it is
 * the one part of the canvas that owns a decoder and therefore must be torn
 * down carefully when the media changes.
 *
 * This is also where tile *geometry* lives, rather than in the renderer. Tile
 * width is set by the clip's aspect ratio, which only the decoder knows, and
 * the tile grid decides which frames get requested. Keeping both here means the
 * renderer receives positions and blits them, with no chance of the two
 * disagreeing about where a tile starts.
 */

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ASPECT_RATIO, FilmstripExtractor, filmstripSlots } from "./filmstrip";
import { endSeconds } from "./timelineGeometry";
import type { TimelineThumbnail, TimelineViewport } from "./timelineTypes";

export interface FilmstripRequest {
  /** Object URL of the attached clip, or null when nothing is attached. */
  readonly objectUrl: string | null;
  readonly viewport: TimelineViewport;
  readonly widthPx: number;
  readonly durationSeconds: number;
  /** Display height of the filmstrip lane, in CSS pixels. */
  readonly laneHeightPx: number;
  /** Device pixel ratio, so frames are decoded at the size they are shown. */
  readonly devicePixelRatio: number;
}

/** Decode heights are quantised to this, so a resize rarely invalidates. */
const HEIGHT_STEP = 16;

/**
 * Tiles covering the current viewport, filling in as frames decode.
 *
 * A tile appears only once its frame is in hand, but its position never moves:
 * the grid is fixed by geometry, so frames land in place rather than shifting
 * the strip as they arrive.
 */
export function useFilmstrip(request: FilmstripRequest): readonly TimelineThumbnail[] {
  const [extractor, setExtractor] = useState<FilmstripExtractor | null>(null);
  // Bumped whenever the extractor's cache changes. Its cache is mutable, so it
  // cannot itself be a dependency; this counter is what stands in for it.
  const [revision, setRevision] = useState(0);

  const { objectUrl, laneHeightPx, devicePixelRatio, viewport, widthPx, durationSeconds } = request;

  const decodeHeight = Math.max(HEIGHT_STEP, Math.round((laneHeightPx * devicePixelRatio) / HEIGHT_STEP) * HEIGHT_STEP);

  useEffect(() => {
    if (!objectUrl) {
      setExtractor(null);
      return;
    }
    const instance = new FilmstripExtractor(objectUrl, () => setRevision((n) => n + 1), decodeHeight);
    setExtractor(instance);
    // Open the decoder straight away: the tile pitch depends on the clip's
    // aspect ratio, so guessing it means re-laying the whole strip a moment later.
    instance.prime();
    return () => {
      setExtractor(null);
      instance.dispose();
    };
  }, [objectUrl, decodeHeight]);

  // A tile is one whole frame at the lane's height. Everything else follows
  // from that: the pitch of the grid, and therefore which frames are wanted.
  const aspect = useMemo(() => extractor?.aspectRatio() ?? DEFAULT_ASPECT_RATIO, [extractor, revision]);
  const tileWidthPx = Math.max(8, Math.round(laneHeightPx * aspect));

  const slots = useMemo(
    () =>
      filmstripSlots(
        viewport.startSeconds,
        endSeconds(viewport, widthPx),
        viewport.secondsPerPixel,
        durationSeconds,
        tileWidthPx,
      ),
    [viewport, widthPx, durationSeconds, tileWidthPx],
  );

  useEffect(() => {
    extractor?.request(slots.map((slot) => slot.decodeSeconds));
  }, [slots, extractor]);

  return useMemo(() => {
    if (!extractor) return [];
    const tiles: TimelineThumbnail[] = [];
    for (const slot of slots) {
      const frame = extractor.frame(slot.decodeSeconds);
      if (!frame) continue;
      tiles.push({ pictureSeconds: slot.slotSeconds, image: frame.image, widthPx: tileWidthPx });
    }
    return tiles;
  }, [slots, tileWidthPx, extractor, revision]);
}
