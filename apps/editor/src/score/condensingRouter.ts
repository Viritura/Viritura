/**
 * Condensing router — resolves edits on condensed staves to source part(s).
 *
 * When a user edits notes on a condensed staff, this module determines
 * which source part(s) should receive the edit based on the active routing mode.
 */
import type { Score, LayoutStaff, LayoutContent, LayoutSource, PartMeasure, NoteEvent } from "@viritura/core";
import { isNoteEvent, isRest } from "@viritura/core";
import type { CondensingMode } from "../components/CondensingPopover";

/**
 * Information about a condensing staff relevant to editing.
 */
export interface CondensingStaffInfo {
  /** The layout staff node. */
  staff: LayoutStaff;
  /** Part indices (0-based) for each source, in source order. */
  sourcePartIndices: number[];
}

/**
 * Find the condensing staff that contains the given partIndex as a source.
 * Returns null if the partIndex is not on a condensing staff.
 */
export function findCondensingStaff(
  score: Score,
  layoutId: string | undefined,
  partIndex: number,
): CondensingStaffInfo | null {
  if (!score.layouts || !layoutId) return null;
  const layout = score.layouts.find((l) => l.id === layoutId);
  if (!layout) return null;

  const partId = score.parts[partIndex]?.id;
  if (!partId) return null;

  return findCondensingStaffInContent(layout.content, score, partId);
}

function findCondensingStaffInContent(
  content: LayoutContent[],
  score: Score,
  targetPartId: string,
): CondensingStaffInfo | null {
  for (const node of content) {
    if (node.type === "group") {
      const result = findCondensingStaffInContent(node.content, score, targetPartId);
      if (result) return result;
    } else if (node.type === "staff") {
      if (node.sources.length < 2) continue;
      const hasSource = node.sources.some((s) => s.part === targetPartId);
      if (!hasSource) continue;

      const sourcePartIndices = resolveSourcePartIndices(node.sources, score);
      return { staff: node, sourcePartIndices };
    }
  }
  return null;
}

/**
 * Resolve LayoutSource[] to part indices using the score's parts array.
 */
function resolveSourcePartIndices(sources: LayoutSource[], score: Score): number[] {
  const indices: number[] = [];
  for (const src of sources) {
    const idx = score.parts.findIndex((p) => p.id === src.part);
    if (idx >= 0) indices.push(idx);
  }
  return indices;
}

/**
 * Given a routing mode and condensing staff info, return the part indices
 * that should receive an edit, along with the voice (sequence index) for each.
 *
 * @param mode - The active routing mode
 * @param staffInfo - The condensing staff info
 * @param currentVoice - The voice (0-based) the user is writing in
 * @returns Array of { partIndex, voice } targets for the edit
 */
export function resolveEditTargets(
  mode: CondensingMode | undefined,
  staffInfo: CondensingStaffInfo,
  currentVoice: number,
): { partIndex: number; voice: number }[] {
  // Smart default: no explicit mode set
  // Voice 1 (0) → broadcast to all sources (a2-like default)
  // Voice 2+ → map to source by voice index (divisi-like)
  const effectiveMode = mode ?? (currentVoice === 0 ? "unison" : "divisi");

  switch (effectiveMode) {
    case "unison":
    case "amalgamate":
      // Broadcast to all source parts, always voice 0
      return staffInfo.sourcePartIndices.map((pi) => ({ partIndex: pi, voice: 0 }));

    case "solo1":
      // Only source 0
      return staffInfo.sourcePartIndices.length > 0 ? [{ partIndex: staffInfo.sourcePartIndices[0]!, voice: 0 }] : [];

    case "solo2":
      // Only source 1
      return staffInfo.sourcePartIndices.length > 1 ? [{ partIndex: staffInfo.sourcePartIndices[1]!, voice: 0 }] : [];

    case "divisi":
      // Voice 0 → source 0, voice 1 → source 1, etc.
      if (currentVoice < staffInfo.sourcePartIndices.length) {
        return [{ partIndex: staffInfo.sourcePartIndices[currentVoice]!, voice: 0 }];
      }
      // Fallback: use first source
      return staffInfo.sourcePartIndices.length > 0 ? [{ partIndex: staffInfo.sourcePartIndices[0]!, voice: 0 }] : [];

    default:
      return [{ partIndex: staffInfo.sourcePartIndices[0]!, voice: 0 }];
  }
}

/**
 * Detect the effective condensing mode for a given measure by analyzing
 * the source part measures. Mirrors the Rust engine's analyze_merge_mode.
 *
 * Priority:
 * 1. Explicit condensingOverride on the first source's PartMeasure
 * 2. Auto-detection from the music content (unison/solo/divisi/amalgamate)
 *
 * @param score - The full score
 * @param staffInfo - The condensing staff info with source part indices
 * @param measureIndex - The measure to analyze
 * @returns The detected CondensingMode, or undefined if not determinable
 */
/** True iff all timelines share the same rhythm (length + base/dots per event). */
function timelinesShareRhythm(timelines: NoteEvent[][]): boolean {
  const ref = timelines[0]!;
  for (let t = 1; t < timelines.length; t++) {
    const tl = timelines[t]!;
    if (tl.length !== ref.length) return false;
    for (let i = 0; i < ref.length; i++) {
      const dr = ref[i]!.duration;
      const dt = tl[i]!.duration;
      if (dr.base !== dt.base || (dr.dots ?? 0) !== (dt.dots ?? 0)) return false;
    }
  }
  return true;
}

/** True iff all timelines have identical pitches at every event slot. */
function timelinesSharePitches(timelines: NoteEvent[][]): boolean {
  const ref = timelines[0]!;
  for (let i = 0; i < ref.length; i++) {
    const pr = ref[i]!.notes ?? [];
    for (let t = 1; t < timelines.length; t++) {
      const pt = timelines[t]![i]!.notes ?? [];
      if (pr.length !== pt.length) return false;
      for (let j = 0; j < pr.length; j++) {
        if (
          pr[j]!.pitch.step !== pt[j]!.pitch.step ||
          pr[j]!.pitch.octave !== pt[j]!.pitch.octave ||
          (pr[j]!.pitch.alter ?? 0) !== (pt[j]!.pitch.alter ?? 0)
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

export function detectCondensingMode(
  score: Score,
  staffInfo: CondensingStaffInfo,
  measureIndex: number,
): CondensingMode | undefined {
  const partMeasures: PartMeasure[] = [];
  for (const pi of staffInfo.sourcePartIndices) {
    const part = score.parts[pi];
    if (!part || measureIndex >= part.measures.length) return undefined;
    partMeasures.push(part.measures[measureIndex]!);
  }
  if (partMeasures.length < 2) return undefined;

  // Check for explicit condensingOverride on first source
  const override = partMeasures[0]!.condensingOverride;
  if (override) {
    const valid: CondensingMode[] = ["unison", "solo1", "solo2", "amalgamate", "divisi"];
    if (valid.includes(override as CondensingMode)) return override as CondensingMode;
  }

  // Auto-detect from content
  const timelines = partMeasures.map((pm) => extractFlatEvents(pm));
  const activeIndices = timelines
    .map((t, i) => ({ i, hasNotes: t.some((e) => !isRest(e)) }))
    .filter((x) => x.hasNotes)
    .map((x) => x.i);

  if (activeIndices.length === 0) return undefined; // all rest
  if (activeIndices.length === 1) {
    return activeIndices[0] === 0 ? "solo1" : "solo2";
  }

  // 2+ active sources — compare rhythms and pitches across all of them.
  // If any pair has differing rhythm → divisi.
  // If all rhythms match and all pitches identical → unison; otherwise amalgamate.
  const activeTimelines = activeIndices.map((i) => timelines[i]!.filter((e) => !isRest(e)));
  if (!timelinesShareRhythm(activeTimelines)) return "divisi";
  return timelinesSharePitches(activeTimelines) ? "unison" : "amalgamate";
}

/** Extract flat NoteEvent list from a PartMeasure (first sequence only). */
function extractFlatEvents(pm: PartMeasure): NoteEvent[] {
  const seq = pm.sequences[0];
  if (!seq) return [];
  const events: NoteEvent[] = [];
  for (const item of seq.content) {
    if (isNoteEvent(item)) events.push(item);
  }
  return events;
}

/**
 * Get the active layout ID for the current score definition.
 */
export function getActiveLayoutId(score: Score, scoreIndex: number): string | undefined {
  const scoreDef = score.scores?.[scoreIndex];
  if (!scoreDef) return undefined;

  // Check pages/systems for layout references
  if (scoreDef.pages) {
    for (const page of scoreDef.pages) {
      for (const sys of page.systems) {
        if (sys.layout) return sys.layout;
      }
    }
  }

  // Use the score-level layout reference
  return scoreDef.layout;
}
