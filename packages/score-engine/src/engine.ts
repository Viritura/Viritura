/**
 * Engine — the public handle returned by `loadEngine()`.
 *
 * Wraps the framework-free chunks of `@viritura/renderer` (WASM bindings,
 * paint primitives, font loading) behind a stable API surface designed
 * for external publication.
 *
 * Today this is a thin facade. In a future major version the underlying
 * implementation can be inlined or swapped without changing the contract.
 */

import {
  initWasm,
  isWasmReady,
  loadMusicFont,
  paintDisplayList,
  wasmComputeMnxScoreLayout,
  getScoreInfo,
  GlyphAtlas,
  PageCache,
  setAssetBasePath,
  splitCommandsByPage,
  beatToX,
} from "@viritura/renderer";
import { parseMnx } from "@viritura/format";
import { generateTimeline } from "@viritura/midi";
import { EngineLoadError, ParseError, LayoutError } from "./errors";
import type { DisplayList, LayoutOptions, PaintOptions, LoadEngineOptions, ScoreMeasurements } from "./types";
import type {
  Timeline,
  TimelineOptions,
  TimedEvent,
  TempoSegment,
  CanvasBeatPosition,
  CanvasBeatHit,
} from "./timeline";

/** Singleton state for the loaded engine — shared across all `loadEngine()` calls. */
let enginePromise: Promise<Engine> | null = null;

/**
 * Load the score engine. Idempotent and concurrent-safe — multiple calls
 * return the same singleton promise. Throws `EngineLoadError` on failure.
 *
 * Today this delegates to `@viritura/renderer`'s `initWasm` + `loadMusicFont`,
 * which serve assets from a same-origin `/wasm/` and `/fonts/` lookup unless
 * `assetBaseUrl` points them at an embedding host's rewritten asset directory.
 */
export async function loadEngine(opts: LoadEngineOptions = {}): Promise<Engine> {
  if (opts.assetBaseUrl) {
    setAssetBasePath(opts.assetBaseUrl);
  }

  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    try {
      await initWasm();
    } catch (err) {
      throw new EngineLoadError(
        `Failed to initialize WASM engine: ${err instanceof Error ? err.message : String(err)}`,
        "wasm",
        err,
      );
    }
    try {
      await loadMusicFont();
    } catch (err) {
      throw new EngineLoadError(
        `Failed to load music font: ${err instanceof Error ? err.message : String(err)}`,
        "font",
        err,
      );
    }
    return new Engine();
  })();
  return enginePromise;
}

/** Returns true if `loadEngine()` has completed. */
export function isEngineReady(): boolean {
  return isWasmReady();
}

/**
 * The score engine handle. Acquire via `loadEngine()`. All methods are
 * pure — they never mutate the engine and never trigger network I/O once
 * `loadEngine()` has resolved.
 */
export class Engine {
  /** GlyphAtlas singleton — built lazily on first paint for accelerated glyph rendering. */
  private glyphAtlas: GlyphAtlas | null = null;
  /** PageCache singleton — caches per-page command splits for efficient repaint. */
  private pageCache: PageCache | null = null;

  /**
   * Compute layout for an MNX document. Returns an opaque `DisplayList`
   * suitable for `paint()`, `measure()`, and (later) `beatToCanvas()`.
   *
   * Throws `ParseError` if the input is not valid MNX, `LayoutError` if
   * the engine itself fails.
   */
  layout(mnx: string | object, opts: LayoutOptions): DisplayList {
    const json = typeof mnx === "string" ? mnx : safeStringify(mnx);
    const spatium = opts.spatium ?? 7;
    const scoreIndex = opts.scoreIndex ?? 0;
    const pageSetupJson = opts.pageSetup
      ? JSON.stringify({
          page_height: opts.pageSetup.height / spatium,
          page_margin_top: opts.pageSetup.margins.top / spatium,
          page_margin_right: opts.pageSetup.margins.right / spatium,
          page_margin_bottom: opts.pageSetup.margins.bottom / spatium,
          page_margin_left: opts.pageSetup.margins.left / spatium,
        })
      : undefined;
    try {
      // The renderer's `wasmComputeMnxScoreLayout` paints the requested
      // layout (score) index. For single-layout MNX documents, score 0
      // is the canonical "main score" view.
      return wasmComputeMnxScoreLayout(json, spatium, opts.pageWidth, scoreIndex, pageSetupJson);
    } catch (err) {
      // The Rust engine raises a string error; the JS glue surfaces it
      // as a generic Error. We classify by message contents.
      const msg = err instanceof Error ? err.message : String(err);
      if (/parse|json|schema|missing field|expected/i.test(msg)) {
        throw new ParseError(`Failed to parse MNX: ${msg}`, "schema", err);
      }
      throw new LayoutError(`Layout failed: ${msg}`, "wasm", err);
    }
  }

  /**
   * Paint a single page from a precomputed `DisplayList` onto a Canvas2D
   * context. The caller is responsible for canvas size, clearing the
   * canvas (paint clears its own page region with white), and any
   * device-pixel-ratio scaling applied via `ctx.setTransform`.
   *
   * For multi-page display lists, set `opts.page` to the desired page index.
   * For single-page or full-document paints, omit `page` (defaults to 0).
   */
  paint(ctx: CanvasRenderingContext2D, displayList: DisplayList, opts: PaintOptions = {}): void {
    const zoom = opts.zoom ?? 1.0;
    const page = opts.page ?? 0;

    // Build glyph atlas lazily once per Engine instance.
    if (!this.glyphAtlas) this.glyphAtlas = new GlyphAtlas();

    ctx.save();
    if (zoom !== 1.0 || opts.scrollX || opts.scrollY) {
      ctx.translate(-(opts.scrollX ?? 0) * zoom, -(opts.scrollY ?? 0) * zoom);
      ctx.scale(zoom, zoom);
    }

    // Keep any built atlas baked at the context's effective device scale
    // (caller DPR × zoom) so glyph blits are 1:1 rather than resampled.
    if (this.glyphAtlas.isBuilt) {
      this.glyphAtlas.ensureDeviceScale(Math.abs(ctx.getTransform?.().a ?? zoom) || zoom);
    }

    // For multi-page lists, split per page and paint just the requested
    // page. For single-page lists or untyped lists, paint the whole DL.
    const pages = displayList.pages;
    if (pages && pages.length > 1) {
      if (!this.pageCache) this.pageCache = new PageCache();
      const split = splitCommandsByPage(displayList);
      const pageDl = split[page];
      if (pageDl) {
        // splitCommandsByPage returns { commands, layout }; reconstruct a
        // proper DisplayList with per-page geometry for paintDisplayList.
        const wrapped: DisplayList = {
          commands: pageDl.commands,
          width: displayList.width,
          height: pageDl.layout.height,
          pages: [pageDl.layout],
        };
        // Translate so the page renders at the canvas origin even though
        // its commands are in absolute (multi-page) coordinates.
        ctx.save();
        ctx.translate(0, -pageDl.layout.yOffset);
        paintDisplayList(ctx, wrapped, this.glyphAtlas);
        ctx.restore();
      }
    } else {
      paintDisplayList(ctx, displayList, this.glyphAtlas);
    }
    ctx.restore();
  }

  /** Per-page measurements derived from a precomputed `DisplayList`. */
  measure(displayList: DisplayList): ScoreMeasurements {
    // PageLayout currently has only height (pages share the DL's width).
    const pages = displayList.pages ?? [{ pageNumber: 1, systemIndices: [], yOffset: 0, height: displayList.height }];
    const pageSizes = pages.map((p) => ({ width: displayList.width, height: p.height }));
    const totalHeight = pageSizes.reduce((sum, p) => sum + p.height, 0);
    const maxPageWidth = displayList.width;
    // Part IDs are not currently exposed on DisplayList; derive from
    // measureBounds if present, otherwise empty. (Phase 4 will lift this
    // into a first-class field.)
    const partIds = new Set<string>();
    if (displayList.measureBounds) {
      for (const mb of displayList.measureBounds) {
        if (typeof mb.partIndex === "number") partIds.add(`p${mb.partIndex}`);
      }
    }
    return {
      pageCount: pages.length,
      pageSizes,
      totalHeight,
      maxPageWidth,
      partIds: [...partIds],
    };
  }

  /**
   * Get score-level info (part count, names, measure count) directly from
   * MNX without running layout. Cheap — useful for previews and TOCs.
   */
  info(mnx: string | object) {
    const json = typeof mnx === "string" ? mnx : safeStringify(mnx);
    try {
      return getScoreInfo(json);
    } catch (err) {
      throw new ParseError(
        `Failed to read score info: ${err instanceof Error ? err.message : String(err)}`,
        "schema",
        err,
      );
    }
  }

  /**
   * Compute a layout-independent playback timeline from MNX.
   *
   * The timeline is what audio engines (and AI accompaniment, MIDI export,
   * follow-the-bouncing-ball animations) consume. It contains note + rest
   * events with absolute beat / time positions, a tempo map, and stable
   * part identifiers — but no audio types (no AudioContext, no SoundFont
   * program numbers, no velocities). Mapping symbolic dynamics to MIDI
   * velocity is the audio engine's responsibility.
   *
   * Deterministic and pure: same MNX → identical timeline.
   */
  timeline(mnx: string | object, opts: TimelineOptions = {}): Timeline {
    const _expansion = opts.repeatExpansion ?? "expand";
    let score;
    try {
      score = parseMnx(typeof mnx === "string" ? JSON.parse(mnx) : mnx);
    } catch (err) {
      throw new ParseError(
        `Failed to parse MNX for timeline: ${err instanceof Error ? err.message : String(err)}`,
        "schema",
        err,
      );
    }
    // generateTimeline always expands repeats today; "ignore" is reserved
    // for future use once @viritura/midi exposes the option.
    const midi = generateTimeline(score);

    const partIds = score.parts.map((_, i) => `p${i + 1}`);
    const tempoMap: TempoSegment[] = midi.tempoMap.map((t) => ({
      beat: beatFromMeasure(t.measureIndex, t.beatInMeasure, midi.measureStartTimes, score),
      timeSeconds: t.timeSeconds,
      bpm: t.bpm,
    }));

    // Pair noteOn / noteOff into TimedEvent entries.
    const events: TimedEvent[] = [];
    const open = new Map<string, { onIdx: number; midiNote: number; partIndex: number; time: number }>();
    for (let i = 0; i < midi.events.length; i++) {
      const ev = midi.events[i]!;
      if (ev.type === "noteOn") {
        open.set(`${ev.partIndex}:${ev.midiNote}:${ev.channel}`, {
          onIdx: events.length,
          midiNote: ev.midiNote,
          partIndex: ev.partIndex,
          time: ev.time,
        });
        events.push({
          partId: partIds[ev.partIndex] ?? `p${ev.partIndex + 1}`,
          beat: secondsToBeats(ev.time, tempoMap),
          durationBeats: 0, // filled in when we see the matching noteOff
          timeSeconds: ev.time,
          midiPitch: ev.midiNote,
          isRest: false,
        });
      } else if (ev.type === "noteOff") {
        const key = `${ev.partIndex}:${ev.midiNote}:${ev.channel}`;
        const opened = open.get(key);
        if (opened) {
          const e = events[opened.onIdx]!;
          events[opened.onIdx] = {
            ...e,
            durationBeats: secondsToBeats(ev.time, tempoMap) - e.beat,
          };
          open.delete(key);
        }
      }
    }

    return {
      totalBeats: secondsToBeats(midi.duration, tempoMap),
      totalSeconds: midi.duration,
      partIds,
      events,
      tempoMap,
    };
  }

  /**
   * Resolve a `(beat, partId)` to its position on the rendered canvas.
   *
   * The display list must come from a previous `engine.layout()` call.
   * Returns `null` when the beat is past the end of the score, or when
   * the part ID is not present in the display list.
   */
  beatToCanvas(displayList: DisplayList, beat: number, partId: string): CanvasBeatPosition | null {
    const partIndex = parsePartId(partId);
    if (partIndex == null) return null;
    const bounds = (displayList.measureBounds ?? []).filter((b) => b.partIndex === partIndex && !b.ghostStaff);
    if (bounds.length === 0) return null;

    // Find the measure that contains this beat. We need to know how many
    // beats per measure each one has — sum totalBeats until we exceed `beat`.
    let cumulative = 0;
    let chosen: (typeof bounds)[number] | null = null;
    let beatInMeasure = beat;
    // measureBounds for a given part are already in measure-index order.
    for (const b of bounds) {
      if (cumulative + b.totalBeats > beat) {
        chosen = b;
        beatInMeasure = beat - cumulative;
        break;
      }
      cumulative += b.totalBeats;
    }
    if (!chosen) return null;

    const x = beatToX({ measureIndex: chosen.index, beat: beatInMeasure }, displayList.measureBounds!);
    if (x == null) return null;

    // Resolve the page this Y belongs to (PageLayout uses yOffset).
    const pages = displayList.pages ?? [];
    let page = 0;
    for (let i = 0; i < pages.length; i++) {
      const top = pages[i]!.yOffset;
      const bottom = top + pages[i]!.height;
      if (chosen.y >= top && chosen.y < bottom) {
        page = i;
        break;
      }
    }

    return { page, x, y: chosen.y, height: chosen.height };
  }

  /**
   * Resolve a canvas hit position to `(beat, partId)`.
   *
   * `page` must match a `page` index from the display list. `x`/`y` are in
   * display-list (pre-zoom) coordinates. Returns `null` if no measure was
   * hit at that position.
   */
  canvasToBeat(displayList: DisplayList, page: number, x: number, y: number): CanvasBeatHit | null {
    const pages = displayList.pages ?? [];
    const pageOffset = pages[page]?.yOffset ?? 0;
    const absY = y + pageOffset;
    const bounds = displayList.measureBounds ?? [];

    // Find any measure whose staff bounding box contains (x, absY).
    const hit = bounds.find(
      (b) => !b.ghostStaff && x >= b.x && x <= b.x + b.width && absY >= b.y && absY <= b.y + b.height,
    );
    if (!hit) return null;

    // Reverse-interpolate beat from beatAnchors.
    const anchors = hit.beatAnchors;
    let beatInMeasure = 0;
    if (anchors && anchors.length >= 2) {
      // Find the spanning anchor pair; linear inverse-interpolate.
      for (let i = 0; i < anchors.length - 1; i++) {
        const lo = anchors[i]!;
        const hi = anchors[i + 1]!;
        if (x >= lo[1] && x <= hi[1]) {
          const range = hi[1] - lo[1];
          const t = range > 0 ? (x - lo[1]) / range : 0;
          beatInMeasure = lo[0] + t * (hi[0] - lo[0]);
          break;
        }
      }
    } else if (hit.totalBeats > 0) {
      const contentX = Math.max(0, x - hit.x - hit.prefixWidth);
      const contentW = hit.width - hit.prefixWidth;
      beatInMeasure = (contentX / contentW) * hit.totalBeats;
    }

    // Sum prior measures' beats for this part to get global beat.
    const partBounds = bounds.filter((b) => b.partIndex === hit.partIndex && !b.ghostStaff && b.index < hit.index);
    const priorBeats = partBounds.reduce((sum, b) => sum + b.totalBeats, 0);
    return { beat: priorBeats + beatInMeasure, partId: `p${hit.partIndex + 1}` };
  }
}

/** Helper: parse "p1" / "p12" → 0-based part index. */
function parsePartId(partId: string): number | null {
  const m = /^p(\d+)$/.exec(partId);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return isNaN(n) || n < 1 ? null : n - 1;
}

/** Helper: convert (measureIndex, beatInMeasure) → global beat by counting measure lengths. */
function beatFromMeasure(
  measureIndex: number,
  beatInMeasure: number,
  measureStartTimes: number[],
  _score: unknown,
): number {
  // Approximation: assume 4 beats per measure. The current MidiTimeline
  // doesn't expose per-measure beat counts directly, but tempo events
  // arrive at measure boundaries so beat positions only matter for the
  // tempo segment ordering, not absolute musical accuracy.
  // Phase 4.x will replace this with score.global.measures[i].time analysis.
  const _ = measureStartTimes; // reserved for future precision
  return measureIndex * 4 + beatInMeasure;
}

/** Helper: convert seconds → beats using a sorted tempo map. */
function secondsToBeats(timeSec: number, tempoMap: TempoSegment[]): number {
  if (tempoMap.length === 0) return timeSec * (120 / 60); // fallback 120 bpm
  // Find the latest tempo that started at or before `timeSec`.
  let active = tempoMap[0]!;
  for (const seg of tempoMap) {
    if (seg.timeSeconds <= timeSec) active = seg;
    else break;
  }
  const beatsPerSec = active.bpm / 60;
  return active.beat + (timeSec - active.timeSeconds) * beatsPerSec;
}

/** JSON.stringify with a friendlier error if the input has cycles. */
function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch (err) {
    throw new ParseError(
      `MNX input is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`,
      "json",
      err,
    );
  }
}
