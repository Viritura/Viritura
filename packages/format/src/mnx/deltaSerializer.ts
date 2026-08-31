/**
 * Delta Serializer — only re-serializes changed measures.
 *
 * Tracks per-measure object references (for Immer structural sharing)
 * and JSON snapshots. When references are identical (===), the measure
 * hasn't changed — skipping JSON.stringify entirely for unchanged data.
 * Falls back to JSON comparison when references differ (non-Immer paths).
 *
 * This is a drop-in optimization for serializeMnx() that reduces
 * serialization time from O(total measures × parts) to O(changed measures).
 */

import type { Score, GlobalMeasure, PartMeasure, Part } from "@viritura/core";
import { serializeMnx, serializeMnxSkeleton, serializeGlobalMeasureObj, serializePartMeasureObj } from "./serializer";

/** Empty measures array token spliced during incremental assembly. */
const EMPTY_MEASURES = '"measures":[]';

/**
 * Serialization result with optional change metadata.
 */
export interface DeltaSerializationResult {
  /** Full MNX JSON string (always valid, always complete). */
  json: string;
  /** Indices of global measures that changed since last call. */
  changedGlobalMeasures: number[];
  /** Map of partIndex → array of changed measure indices. */
  changedPartMeasures: Map<number, number[]>;
  /** True if structural changes occurred (parts added/removed, layouts changed). */
  structuralChange: boolean;
  /** True when only the root time-signature engraving policy changed. */
  timeSignatureSettingsChange: boolean;
}

export interface DeltaPreparationResult {
  changedGlobalMeasures: number[];
  changedPartMeasures: Map<number, number[]>;
  structuralChange: boolean;
  timeSignatureSettingsChange: boolean;
  hasChanges: boolean;
}

/**
 * Incremental MNX serializer that caches per-measure JSON and object references.
 *
 * With Immer's structural sharing, unchanged objects keep the same reference.
 * This allows O(1) change detection per measure via === comparison, avoiding
 * JSON.stringify for unchanged measures entirely.
 */
export class DeltaSerializer {
  // Object reference caches — when refs match, JSON is unchanged
  private globalMeasureRefs: GlobalMeasure[] = [];
  private partMeasureRefs: PartMeasure[][] = [];

  // Per-measure JSON caches (populated on first serialize or when ref changes).
  // These hold the *raw model* JSON, used only for change detection.
  private globalMeasureCache: string[] = [];
  private partMeasureCaches: string[][] = [];

  // Per-measure MNX-output JSON caches (the serialized MNX form). Kept in
  // lockstep with the detection caches above. Used to assemble the full JSON
  // and WASM patch JSON by splicing cached strings — avoiding a full
  // serializeMnx() transform on every edit.
  private globalMeasureMnxCache: string[] = [];
  private partMeasureMnxCaches: string[][] = [];

  // Structural reference caches
  private layoutsRef: unknown = undefined;
  private scoresRef: unknown = undefined;
  private metadataRef: unknown = undefined;
  private textStylesRef: unknown = undefined;
  private timeSignaturesRef: unknown = undefined;
  private soundProfileRef: unknown = undefined;
  private globalLyricsRef: unknown = undefined;
  private mnxRef: unknown = undefined;
  private partsHeaderRefs: Part[] = [];

  // Structural JSON caches (fallback when refs differ)
  private partsHeaderCache: string[] = [];
  private layoutsCache = "";
  private scoresCache = "";
  private metadataCache = "";
  private textStylesCache = "";
  private timeSignaturesCache = "";
  private soundProfileCache = "";
  private globalLyricsCache = "";
  private mnxCache = "";

  // Full JSON cache
  private fullJsonCache = "";

  /**
   * Serialize a Score model, reusing cached JSON for unchanged measures.
   * Always returns a complete, valid MNX JSON string.
   */
  serialize(score: Score): DeltaSerializationResult {
    const prepared = this.prepare(score);
    if (!prepared.hasChanges && this.fullJsonCache) {
      return {
        json: this.fullJsonCache,
        changedGlobalMeasures: [],
        changedPartMeasures: new Map(),
        structuralChange: false,
        timeSignatureSettingsChange: false,
      };
    }

    return {
      json: this.assemble(score),
      changedGlobalMeasures: prepared.changedGlobalMeasures,
      changedPartMeasures: prepared.changedPartMeasures,
      structuralChange: prepared.structuralChange,
      timeSignatureSettingsChange: prepared.timeSignatureSettingsChange,
    };
  }

  /** Update structural/per-measure caches and report the delta without
   * assembling the complete document string. */
  prepare(score: Score): DeltaPreparationResult {
    const changedGlobalMeasures: number[] = [];
    const changedPartMeasures = new Map<number, number[]>();

    // All four checks have cache/ref side-effects and MUST run every call,
    // even when an earlier one already reports a structural change — short-
    // circuiting with `||` would skip the cache updates for the un-called
    // checks, so the next call would re-report stale fields as changed.
    const sf = this.checkStructuralFields(score);
    const timeSignatureSettingsChange = this.checkTimeSignatureSettings(score);
    const ph = this.checkPartsHeader(score);
    const gm = this.checkGlobalMeasures(score, changedGlobalMeasures);
    const pm = this.checkPartMeasures(score, changedPartMeasures);
    const structuralChange = sf || ph || gm || pm;

    const hasChanges =
      structuralChange ||
      timeSignatureSettingsChange ||
      changedGlobalMeasures.length > 0 ||
      changedPartMeasures.size > 0;

    return {
      changedGlobalMeasures,
      changedPartMeasures,
      structuralChange,
      timeSignatureSettingsChange,
      hasChanges,
    };
  }

  /** Assemble and retain the complete MNX JSON from the current caches. */
  assemble(score: Score): string {
    const json = this.assembleFullJson(score);
    this.fullJsonCache = json;
    return json;
  }

  /**
   * Assemble the full MNX JSON by splicing cached per-measure MNX strings into
   * a measure-stripped skeleton. This keeps the cost proportional to the
   * *changed* measures (re-serialized in the check* passes) plus a single
   * O(total bytes) string concat — instead of re-running serializeMnx() over
   * every measure on each edit.
   *
   * Falls back to a full serializeMnx() if the splice template doesn't contain
   * the expected number of measure-array slots (defensive; should never happen).
   */
  private assembleFullJson(score: Score): string {
    const skeleton = JSON.stringify(serializeMnxSkeleton(score));
    const contents: string[] = [
      this.globalMeasureMnxCache.join(","),
      ...this.partMeasureMnxCaches.map((cache) => cache.join(",")),
    ];

    let out = "";
    let cursor = 0;
    let slot = 0;
    for (;;) {
      const at = skeleton.indexOf(EMPTY_MEASURES, cursor);
      if (at === -1) break;
      if (slot >= contents.length) {
        // More slots than expected — bail to the safe path.
        return JSON.stringify(serializeMnx(score));
      }
      out += skeleton.slice(cursor, at) + '"measures":[' + contents[slot] + "]";
      cursor = at + EMPTY_MEASURES.length;
      slot++;
    }
    out += skeleton.slice(cursor);

    if (slot !== contents.length) {
      return JSON.stringify(serializeMnx(score));
    }
    return out;
  }

  /**
   * Build a WASM patch JSON ({ globalMeasures, partMeasures, timeSignatures })
   * directly from the current caches. O(changed measures) — no full-score parse.
   * Must be called immediately after `serialize()`, using its returned change
   * sets, so the MNX caches are fresh.
   */
  buildPatch(
    changedGlobalMeasures: number[],
    changedPartMeasures: Map<number, number[]>,
    includeTimeSignatureSettings = false,
  ): string {
    const sections: string[] = [];
    if (changedGlobalMeasures.length > 0) {
      const entries = changedGlobalMeasures.map((mi) => `"${mi}":${this.globalMeasureMnxCache[mi]}`);
      sections.push(`"globalMeasures":{${entries.join(",")}}`);
    }
    if (changedPartMeasures.size > 0) {
      const partEntries: string[] = [];
      for (const [pi, indices] of changedPartMeasures) {
        const cache = this.partMeasureMnxCaches[pi]!;
        const mEntries = indices.map((mi) => `"${mi}":${cache[mi]}`);
        partEntries.push(`"${pi}":{${mEntries.join(",")}}`);
      }
      sections.push(`"partMeasures":{${partEntries.join(",")}}`);
    }
    if (includeTimeSignatureSettings) {
      sections.push(`"timeSignatures":${this.timeSignaturesCache || "null"}`);
    }
    return `{${sections.join(",")}}`;
  }

  /**
   * Reference-equality + JSON-fallback check for the top-level structural
   * fields (mnx — version + support, global.lyrics, layouts, scores, metadata,
   * textStyles, soundProfile). Returns true if any field's serialized form changed.
   */
  private checkStructuralFields(score: Score): boolean {
    let structuralChange = false;
    const slots = [
      {
        value: score.mnx,
        refKey: "mnxRef" as const,
        cacheKey: "mnxCache" as const,
      },
      {
        value: score.global.lyrics,
        refKey: "globalLyricsRef" as const,
        cacheKey: "globalLyricsCache" as const,
      },
      {
        value: score.layouts,
        refKey: "layoutsRef" as const,
        cacheKey: "layoutsCache" as const,
      },
      {
        value: score.scores,
        refKey: "scoresRef" as const,
        cacheKey: "scoresCache" as const,
      },
      {
        value: score.metadata,
        refKey: "metadataRef" as const,
        cacheKey: "metadataCache" as const,
      },
      {
        value: score.textStyles,
        refKey: "textStylesRef" as const,
        cacheKey: "textStylesCache" as const,
      },
      {
        value: score.soundProfile,
        refKey: "soundProfileRef" as const,
        cacheKey: "soundProfileCache" as const,
      },
    ];
    for (const slot of slots) {
      const value = slot.value;
      if (value === this[slot.refKey]) continue;
      const json = value ? JSON.stringify(value) : "";
      if (json !== this[slot.cacheKey]) {
        structuralChange = true;
        this[slot.cacheKey] = json;
      }
      this[slot.refKey] = value;
    }
    return structuralChange;
  }

  private checkTimeSignatureSettings(score: Score): boolean {
    const value = score.timeSignatures;
    if (value === this.timeSignaturesRef) return false;
    const json = value ? JSON.stringify(value) : "";
    const changed = json !== this.timeSignaturesCache;
    this.timeSignaturesCache = json;
    this.timeSignaturesRef = value;
    return changed;
  }

  /** Returns true if part count or any part header changed. */
  private checkPartsHeader(score: Score): boolean {
    let structuralChange = false;
    if (score.parts.length !== this.partMeasureCaches.length) {
      structuralChange = true;
    }
    for (let pi = 0; pi < score.parts.length; pi++) {
      const part = score.parts[pi]!;
      if (part === this.partsHeaderRefs[pi]) continue;
      const hdr = partHeaderJson(part);
      if (pi >= this.partsHeaderCache.length || this.partsHeaderCache[pi] !== hdr) {
        structuralChange = true;
        this.partsHeaderCache[pi] = hdr;
      }
      this.partsHeaderRefs[pi] = part;
    }
    if (this.partsHeaderCache.length > score.parts.length) {
      structuralChange = true;
      this.partsHeaderCache.length = score.parts.length;
      this.partsHeaderRefs.length = score.parts.length;
    }
    return structuralChange;
  }

  /** Updates per-global-measure caches; appends changed indices to `changed`. */
  private checkGlobalMeasures(score: Score, changed: number[]): boolean {
    const gmCount = score.global.measures.length;
    const structuralChange = gmCount !== this.globalMeasureCache.length;

    for (let mi = 0; mi < gmCount; mi++) {
      const gm = score.global.measures[mi]!;
      if (gm === this.globalMeasureRefs[mi]) continue;
      const json = JSON.stringify(gm);
      if (mi >= this.globalMeasureCache.length || this.globalMeasureCache[mi] !== json) {
        changed.push(mi);
        this.globalMeasureCache[mi] = json;
        this.globalMeasureMnxCache[mi] = JSON.stringify(serializeGlobalMeasureObj(gm));
      }
      this.globalMeasureRefs[mi] = gm;
    }
    this.globalMeasureCache.length = gmCount;
    this.globalMeasureMnxCache.length = gmCount;
    this.globalMeasureRefs.length = gmCount;
    return structuralChange;
  }

  /** Updates per-part-measure caches; appends changed indices to `changed`. */
  private checkPartMeasures(score: Score, changed: Map<number, number[]>): boolean {
    while (this.partMeasureCaches.length < score.parts.length) {
      this.partMeasureCaches.push([]);
      this.partMeasureMnxCaches.push([]);
      this.partMeasureRefs.push([]);
    }
    this.partMeasureCaches.length = score.parts.length;
    this.partMeasureMnxCaches.length = score.parts.length;
    this.partMeasureRefs.length = score.parts.length;

    let structuralChange = false;
    for (let pi = 0; pi < score.parts.length; pi++) {
      const part = score.parts[pi]!;
      const cache = this.partMeasureCaches[pi]!;
      const mnxCache = this.partMeasureMnxCaches[pi]!;
      const refs = this.partMeasureRefs[pi]!;
      const pmCount = part.measures.length;

      if (pmCount !== cache.length) structuralChange = true;

      for (let mi = 0; mi < pmCount; mi++) {
        const pm = part.measures[mi]!;
        if (pm === refs[mi]) continue;
        const json = JSON.stringify(pm);
        if (mi >= cache.length || cache[mi] !== json) {
          if (!changed.has(pi)) changed.set(pi, []);
          changed.get(pi)!.push(mi);
          cache[mi] = json;
          mnxCache[mi] = JSON.stringify(serializePartMeasureObj(pm));
        }
        refs[mi] = pm;
      }
      cache.length = pmCount;
      mnxCache.length = pmCount;
      refs.length = pmCount;
    }
    return structuralChange;
  }

  /**
   * Invalidate the entire cache (e.g. after loading a new score).
   */
  invalidate(): void {
    this.globalMeasureCache = [];
    this.globalMeasureMnxCache = [];
    this.globalMeasureRefs = [];
    this.partMeasureCaches = [];
    this.partMeasureMnxCaches = [];
    this.partMeasureRefs = [];
    this.partsHeaderCache = [];
    this.partsHeaderRefs = [];
    this.layoutsCache = "";
    this.layoutsRef = undefined;
    this.scoresCache = "";
    this.scoresRef = undefined;
    this.metadataCache = "";
    this.metadataRef = undefined;
    this.textStylesCache = "";
    this.textStylesRef = undefined;
    this.timeSignaturesCache = "";
    this.timeSignaturesRef = undefined;
    this.soundProfileCache = "";
    this.soundProfileRef = undefined;
    this.globalLyricsCache = "";
    this.globalLyricsRef = undefined;
    this.mnxCache = "";
    this.mnxRef = undefined;
    this.fullJsonCache = "";
  }
}

/** Serialize part-level header fields (everything except measures) for comparison. */
function partHeaderJson(part: {
  name: string;
  shortName?: string;
  staves?: number;
  id?: string;
  transposition?: unknown;
  kit?: unknown;
  _x?: unknown;
}): string {
  return JSON.stringify({
    id: part.id,
    name: part.name,
    shortName: part.shortName,
    staves: part.staves,
    transposition: part.transposition,
    // `kit` is part-level (drum-kit mapping: staff positions, noteheads,
    // sounds). It isn't measure data, so changes here are invisible to the
    // per-measure checks — fold it into the header so a kit edit registers as
    // a structural change and the part re-layouts (every kit-note resolves its
    // staffPosition + notehead from this dict).
    kit: part.kit,
    _x: part._x,
  });
}
