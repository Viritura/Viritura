/**
 * Filmstrip extraction.
 *
 * Thumbnails along the top of the timeline are how a composer navigates a cut
 * they have watched twenty times: they recognise the shot long before they
 * would recognise the timecode. It is a navigation aid, not a preview, so the
 * bar for quality is low and the bar for *not costing anything* is high.
 *
 * The strip is laid out the way an NLE lays one out, and that is a specific
 * thing worth stating: **tiles are always whole frames at their natural aspect
 * ratio, laid edge to edge, and the frames between them are simply omitted.**
 * Zooming out does not squeeze frames narrower — it drops more of them. The
 * alternative (spacing tiles on a ladder of round timestamps) is what this
 * module used to do, and it produced overlapping slivers whenever the ladder
 * was finer than one frame's width.
 *
 * So the tile grid is derived from the frame's own width in pixels:
 *
 *   secondsPerTile = tileWidthPx x secondsPerPixel
 *
 * which by construction tiles the lane exactly, with no gaps and no overlap, at
 * every zoom level.
 *
 * That grid moves continuously with zoom, so decode times are snapped to a
 * quantum chosen from the tile spacing. A tile then shows the nearest already-
 * decoded frame rather than a frame nobody has fetched, which is what keeps the
 * cache paying off while zooming. Being up to half a quantum off the tile's
 * exact start is invisible in a 44-pixel-tall navigation aid.
 *
 * Extraction uses a second, detached `<video>` on the same object URL rather
 * than the one being played. Seeking the playback element to grab a frame would
 * fight the synchronizer and visibly jump the picture.
 *
 * Seeks are serialised. Browsers coalesce concurrent `currentTime` writes and
 * you get back whichever frame happened to land, so overlapping requests
 * produce a filmstrip that is subtly wrong in a way that is very hard to see.
 */

/** Aspect assumed until the clip's metadata says otherwise. */
export const DEFAULT_ASPECT_RATIO = 16 / 9;

/**
 * Height a thumbnail is decoded at, when the caller does not say.
 *
 * Callers should say: a thumbnail decoded at anything other than the height it
 * will be blitted at gets rescaled on every paint and reads soft.
 */
const DEFAULT_THUMBNAIL_HEIGHT = 44;

/** Bound on retained thumbnails, oldest evicted first. */
const CACHE_LIMIT = 240;

/**
 * Decode times are snapped to one of these, so that zooming keeps asking for
 * frames that are already in hand.
 */
const DECODE_QUANTA = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300] as const;

/** One decoded frame, cached by the time it was decoded at. */
export interface DecodedFrame {
  readonly decodeSeconds: number;
  readonly image: CanvasImageSource;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** One position in the strip: where it sits, and which frame fills it. */
export interface FilmstripSlot {
  /** Picture time at the tile's left edge. */
  readonly slotSeconds: number;
  /** Time actually decoded — snapped, so zooming reuses frames. */
  readonly decodeSeconds: number;
}

/**
 * The quantum decode times are snapped to.
 *
 * The largest rung that still fits inside one tile, so neighbouring tiles never
 * collapse onto the same frame. Below the finest rung there is nothing to gain:
 * at that zoom the composer is looking at individual frames anyway.
 */
export function decodeQuantum(secondsPerTile: number): number {
  let quantum: number = DECODE_QUANTA[0];
  for (const candidate of DECODE_QUANTA) {
    if (candidate > secondsPerTile) break;
    quantum = candidate;
  }
  return quantum;
}

/**
 * The tiles covering a viewport.
 *
 * Anchored to picture time zero rather than to the viewport's left edge, so
 * panning slides the existing tiles rather than renumbering all of them.
 */
export function filmstripSlots(
  startSeconds: number,
  endSeconds: number,
  secondsPerPixel: number,
  durationSeconds: number,
  tileWidthPx: number,
): FilmstripSlot[] {
  if (secondsPerPixel <= 0 || tileWidthPx <= 0 || durationSeconds <= 0) return [];

  const secondsPerTile = tileWidthPx * secondsPerPixel;
  if (!Number.isFinite(secondsPerTile) || secondsPerTile <= 0) return [];

  const quantum = decodeQuantum(secondsPerTile);
  const firstIndex = Math.max(0, Math.floor(startSeconds / secondsPerTile));
  const lastIndex = Math.floor(Math.min(endSeconds, durationSeconds) / secondsPerTile);

  const slots: FilmstripSlot[] = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const slotSeconds = index * secondsPerTile;
    if (slotSeconds > durationSeconds) break;
    const snapped = Math.round(slotSeconds / quantum) * quantum;
    slots.push({
      slotSeconds,
      decodeSeconds: Math.min(durationSeconds, Math.max(0, Number(snapped.toFixed(3)))),
    });
  }
  return slots;
}

/**
 * A lazily-filled filmstrip for one clip.
 *
 * Owns its own decoder; call `dispose` when the media changes.
 */
export class FilmstripExtractor {
  private readonly cache = new Map<number, DecodedFrame>();
  private readonly pending = new Set<number>();
  private queue: number[] = [];
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private draining = false;
  private disposed = false;
  private aspect = DEFAULT_ASPECT_RATIO;

  constructor(
    private readonly objectUrl: string,
    private readonly onChanged: () => void,
    private readonly thumbnailHeight: number = DEFAULT_THUMBNAIL_HEIGHT,
  ) {}

  /**
   * The clip's aspect ratio.
   *
   * Reported as soon as metadata loads, because the tile grid is derived from
   * the frame's width and a wrong assumption there means the whole strip is
   * laid out at the wrong pitch until the first frame arrives.
   */
  aspectRatio(): number {
    return this.aspect;
  }

  /** The decoded frame for a snapped time, if it is in hand. */
  frame(decodeSeconds: number): DecodedFrame | undefined {
    return this.cache.get(decodeSeconds);
  }

  /**
   * Ask for these decode times, nearest the middle of the view first.
   *
   * Filling outward from the centre matters when zooming: the composer is
   * looking at where they zoomed, and a strip that fills from the left edge
   * makes them wait for frames they are not reading.
   *
   * Anything still queued from a previous view is abandoned — it is off-screen
   * now, and each stale seek delays a frame the composer is actually looking
   * at. The release happens *before* the incoming times are filtered, and that
   * order is load-bearing twice over. `pending` exists to stop a frame being
   * asked for twice, so an entry left behind is a frame that can never be
   * asked for again; and a time present in both the old queue and the new
   * request would otherwise be filtered out as already-pending and then
   * released, ending up neither queued nor pending. Since zooming re-asks for
   * the same quantised times by design, that overlap is the common case, not
   * the corner.
   *
   * The in-flight time needs no special handling: `drain` shifts it off the
   * queue before awaiting, so it is not among the abandoned, and its `pending`
   * entry is cleared when the decode settles.
   */
  request(times: readonly number[]): void {
    if (this.disposed) return;

    for (const abandoned of this.queue) this.pending.delete(abandoned);
    this.queue = [];

    const wanted = times.filter((t) => !this.cache.has(t) && !this.pending.has(t));
    if (wanted.length === 0) return;

    for (const seconds of wanted) this.pending.add(seconds);
    const middle = wanted[Math.floor(wanted.length / 2)]!;
    this.queue = [...wanted].sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
    void this.drain();
  }

  /** Ensure the decoder exists, so the aspect ratio is known early. */
  prime(): void {
    if (this.disposed || this.video) return;
    void this.ensureVideo().catch(() => {
      // A clip that will not decode simply has no filmstrip.
    });
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.pending.clear();
    this.cache.clear();
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
      this.video = null;
    }
    this.canvas = null;
  }

  private async drain(): Promise<void> {
    if (this.draining || this.disposed) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const seconds = this.queue.shift()!;
        try {
          const frame = await this.extract(seconds);
          if (this.disposed) return;
          if (frame) {
            this.cache.set(seconds, frame);
            this.evictIfNeeded();
            this.onChanged();
          }
        } catch {
          // A frame that will not decode is not worth retrying or reporting;
          // the strip simply has a gap there.
        } finally {
          this.pending.delete(seconds);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async extract(seconds: number): Promise<DecodedFrame | null> {
    const video = await this.ensureVideo();
    if (!video) return null;

    await seekTo(video, seconds);
    if (this.disposed) return null;

    const height = Math.max(8, Math.round(this.thumbnailHeight));
    const width = Math.max(1, Math.round(height * this.aspect));

    const canvas = (this.canvas ??= document.createElement("canvas"));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);

    // An ImageBitmap is cheaper to blit repeatedly than a canvas, and the
    // timeline redraws on every pointer move.
    const image = typeof createImageBitmap === "function" ? await createImageBitmap(canvas) : await copyCanvas(canvas);
    return { decodeSeconds: seconds, image, widthPx: width, heightPx: height };
  }

  private async ensureVideo(): Promise<HTMLVideoElement | null> {
    if (this.video) return this.video;
    if (typeof document === "undefined") return null;

    const video = document.createElement("video");
    video.src = this.objectUrl;
    video.muted = true;
    video.preload = "auto";
    // Never rendered; kept out of the layout entirely rather than hidden, so it
    // cannot affect the page's size or be picked up by the accessibility tree.
    video.setAttribute("aria-hidden", "true");
    this.video = video;

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("The clip could not be decoded for thumbnails."));
      };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("error", onError);
      video.load();
    });

    if (this.disposed) return null;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const aspect = video.videoWidth / video.videoHeight;
      if (aspect !== this.aspect) {
        this.aspect = aspect;
        // The tile pitch is derived from this, so the strip has to be re-laid.
        this.onChanged();
      }
    }
    return video;
  }

  /**
   * Drop the oldest frames once the cache is full.
   *
   * Dropped, not closed. `ImageBitmap.close()` is a manual free, and this class
   * is never the last owner: the timeline paints from a scene snapshot on an
   * animation frame, and React's render is asynchronous with respect to this
   * decode loop, so a frame can leave the cache while a queued paint still
   * holds it. Closing it there produced `InvalidStateError: the image source is
   * detached` and took the whole timeline paint down with it.
   *
   * There is no moment at which this class can know a bitmap is unreferenced,
   * so it does not try. Releasing the reference and letting the collector do it
   * is both correct and cheap here — the cache is bounded, and these are
   * roughly 100x55 tiles, so the whole cache is a few megabytes.
   */
  private evictIfNeeded(): void {
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next();
      if (oldest.done) return;
      this.cache.delete(oldest.value);
    }
  }
}

/** Seek and wait for the frame to actually be there. */
function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Seek failed."));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = seconds;
  });
}

/** Fallback where `createImageBitmap` is unavailable. */
async function copyCanvas(canvas: HTMLCanvasElement): Promise<CanvasImageSource> {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d")?.drawImage(canvas, 0, 0);
  return copy;
}
