import { DOMParser } from "@xmldom/xmldom";
import { DiagnosticCollector } from "@viritura/core";
import type { MnxDocument } from "../types";
import { collectLossyDiagnostics } from "./diagnostics";
import { buildGlobalMeasures } from "./globalMeasures";
import { IdGenerator } from "./idGenerator";
import { buildLayout, buildLayoutsAndScores } from "./layout";
import { extractMetadata } from "./metadata";
import { buildParts } from "./parts";
import { getPartsInfo } from "./partsInfo";
import { applyPercussionKits } from "./percussion";

/** Options for MusicXML → MNX conversion */
export interface ConvertOptions {
  /**
   * When true, features not in the MNX spec are preserved as
   * `_x.viritura` vendor extensions. Default is false (strict MNX output).
   */
  includeVendorExtensions?: boolean;
  /**
   * When true, explicit per-note stem directions (`<stem>up|down</stem>`) are
   * dropped so the engine computes stem orientation itself. Many exporters
   * write an explicit stem on every note (serializing their own auto-computed
   * direction), which overrides Viritura's voice-aware stem convention — most
   * visibly when divisi is flattened onto one staff and the upper voice keeps
   * its single-staff "down" stems. Default is false (explicit stems preserved
   * as authored).
   */
  discardStemDirections?: boolean;
  /**
   * When true, a numeric metronome mark is hidden (not engraved) whenever the
   * same tempo also carries a written tempo text (e.g. "Molto moderato"). The
   * bpm is kept for playback but tagged `showMetronomeMark: false`. Useful for
   * older repertoire that is conventionally text-only, where the metronome bpm
   * is an implicit playback value rather than an engraved marking. Requires
   * `includeVendorExtensions` (tempo text is itself a vendor extension).
   * Default is false (metronome marks shown as authored).
   */
  hideMetronomeWhenTempoText?: boolean;
  /**
   * Optional collector for lossy-conversion diagnostics. The converter pushes
   * one entry per dropped or approximated MusicXML feature so callers (UIs,
   * CLIs, tests) can surface them. Generic shape from `@viritura/core`.
   */
  diagnostics?: DiagnosticCollector;
  /** Optional mutable collector populated when unpitched percussion mappings
   *  should be reviewed by a host UI. Does not alter the generated MNX. */
  percussionReviews?: PercussionImportReview[];
}

export interface PercussionImportReview {
  partId: string;
  partName: string;
  confidence: "low";
  reason: string;
}

/**
 * Convert a MusicXML string to an MNX document object (MNX version 7).
 * Works in both browser and Node.js — uses @xmldom/xmldom for parsing.
 *
 * By default produces strict MNX-compliant output. Enable
 * `includeVendorExtensions` to preserve extra features as `_x.viritura`.
 */
export function convertMusicXmlToMnx(xmlString: string, options?: ConvertOptions): MnxDocument {
  const opts = options ?? {};
  const vendorExt = opts.includeVendorExtensions === true;
  const discardStemDirections = opts.discardStemDirections === true;
  const hideMetronomeWhenTempoText = opts.hideMetronomeWhenTempoText === true;
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");
  const root = doc.documentElement as unknown as Element;
  if (!root) throw new Error("Invalid MusicXML: no document element");

  const ids = new IdGenerator();
  const { parts: partsInfo, groups } = getPartsInfo(root);
  const metadata = extractMetadata(root);
  const globalMeasures = buildGlobalMeasures(root, ids, vendorExt, hideMetronomeWhenTempoText);
  const { mnxParts, lyricLineIds } = buildParts(root, partsInfo, globalMeasures, ids, vendorExt, {
    discardStemDirections,
  });
  const layoutContent = buildLayout(partsInfo, groups);

  const result: MnxDocument = {
    mnx: { version: 7 },
    global: { measures: globalMeasures },
    parts: mnxParts,
  };

  // Route unpitched-percussion parts to drum-kit notes so playback uses the
  // GM drum channel instead of voicing them as piano.
  const percussionReviews = applyPercussionKits(result, partsInfo);
  opts.percussionReviews?.push(...percussionReviews);

  // Lyrics global metadata
  if (lyricLineIds.size > 0) {
    const lineOrder = Array.from(lyricLineIds).sort();
    const lineMetadata: Record<string, { label?: string }> = {};
    for (const id of lineOrder) {
      // Extract line number from id (e.g., "line-1" → "Verse 1")
      const num = id.replace("line-", "");
      lineMetadata[id] = { label: `Verse ${num}` };
    }
    result.global.lyrics = { lineMetadata, lineOrder };
  }

  // Layouts & scores: a full score, an auto-condensed score (winds/brass
  // same-instrument pairs merged onto shared staves), and one score per part.
  if (layoutContent.length > 0) {
    const { layouts, scores } = buildLayoutsAndScores(layoutContent, partsInfo, mnxParts, globalMeasures);
    result.layouts = layouts;
    result.scores = scores;
  }

  // Score metadata as vendor extension (only if enabled)
  if (vendorExt && (metadata.title || metadata.composer || metadata.lyricist || metadata.arranger)) {
    const metaExt: Record<string, string> = {};
    if (metadata.title) metaExt["title"] = metadata.title;
    if (metadata.subtitle) metaExt["subtitle"] = metadata.subtitle;
    if (metadata.composer) metaExt["composer"] = metadata.composer;
    if (metadata.lyricist) metaExt["lyricist"] = metadata.lyricist;
    if (metadata.arranger) metaExt["arranger"] = metadata.arranger;
    if (metadata.workTitle) metaExt["workTitle"] = metadata.workTitle;
    if (metadata.workNumber) metaExt["workNumber"] = metadata.workNumber;
    if (metadata.movementTitle) metaExt["movementTitle"] = metadata.movementTitle;
    if (metadata.movementNumber) metaExt["movementNumber"] = metadata.movementNumber;
    (result as unknown as Record<string, unknown>)["_x"] = { viritura: { metadata: metaExt } };
  }

  // Surface lossy-conversion diagnostics for the host UI.
  if (opts.diagnostics) {
    collectLossyDiagnostics(root, opts.diagnostics, vendorExt);
  }

  return result;
}
