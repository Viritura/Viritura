/**
 * Enriches a SpatialIndex with model-path element IDs when the Rust engine
 * doesn't provide them (element_ids empty in JSON output).
 *
 * Strategy: noteheads are rendered as DrawGlyph commands with SMuFL codepoints.
 * the display list in the same order as events in the score model (part by
 * part, measure by measure, voice by voice, event by event). We match them
 * 1:1 by order and re-ID the spatial index entries.
 */

import type { Score } from "@viritura/core";
import type { DisplayList, PatchInfo } from "@viritura/renderer";
import { SpatialIndex } from "@viritura/renderer";
import { eventSuffix } from "../score/ElementPath";

/**
 * Build a SpatialIndex from a DisplayList, enriching entries with
 * model-path element IDs (p{}/m{}/s{}/{eventId}) when the Rust engine
 * doesn't provide element_ids.
 */
type ModelEvent = { id: string; partIndex: number; measureIndex: number; seqIndex: number; eventIndex: number };

/** Walk the score and emit a flat list of pitched (non-rest) events with stable IDs. */
function collectPitchedEvents(score: Score): ModelEvent[] {
  const out: ModelEvent[] = [];
  for (let p = 0; p < score.parts.length; p++) {
    const part = score.parts[p];
    if (!part) continue;
    for (let m = 0; m < part.measures.length; m++) {
      const measure = part.measures[m];
      if (!measure) continue;
      for (let s = 0; s < measure.sequences.length; s++) {
        const seq = measure.sequences[s];
        if (!seq) continue;
        for (let e = 0; e < seq.content.length; e++) {
          const ev = seq.content[e];
          if (!ev || !("type" in ev) || ev.type !== "event") continue;
          if ("rest" in ev && ev.rest) continue;
          if (!ev.notes || ev.notes.length === 0) continue;
          const evId = eventSuffix(ev.id, e, m, s);
          const elementId = `p${p}/m${m}/s${s}/${evId}`;
          out.push({ id: elementId, partIndex: p, measureIndex: m, seqIndex: s, eventIndex: e });
        }
      }
    }
  }
  return out;
}

export function buildEnrichedSpatialIndex(dl: DisplayList, score: Score | null): SpatialIndex {
  const si = SpatialIndex.fromDisplayList(dl);

  // If the Rust engine provided element bboxes or element IDs, we're done
  if ((dl.elementBboxes && dl.elementBboxes.length > 0) || (dl.elementIds && dl.elementIds.length > 0)) {
    return si;
  }

  // No element IDs from Rust — try to enrich by matching noteheads to events
  if (!score) return si;

  // SMuFL notehead codepoints (U+E0A0 range)
  const NOTEHEAD_CODEPOINTS = new Set([
    0xe0a0, // double whole
    0xe0a2, // whole
    0xe0a3, // half
    0xe0a4, // black (filled — quarter and shorter)
  ]);

  // Collect notehead positions from the display list (DrawGlyph commands with notehead codepoints)
  const noteheadCmds: { cmdIndex: number; x: number; y: number }[] = [];
  for (let i = 0; i < dl.commands.length; i++) {
    const cmd = dl.commands[i];
    if (cmd && cmd.type === "DrawGlyph" && NOTEHEAD_CODEPOINTS.has(cmd.codepoint)) {
      noteheadCmds.push({ cmdIndex: i, x: cmd.x, y: cmd.y });
    }
  }

  if (noteheadCmds.length === 0) {
    return si;
  }

  const modelEvents = collectPitchedEvents(score);

  // Build a mapping: cmd/N → model element ID
  // Match noteheads to events by order (both are in temporal/spatial order)
  const cmdToElementId = new Map<string, string>();
  const matchCount = Math.min(noteheadCmds.length, modelEvents.length);
  for (let i = 0; i < matchCount; i++) {
    const nh = noteheadCmds[i]!;
    const ev = modelEvents[i]!;
    cmdToElementId.set(`cmd/${nh.cmdIndex}`, ev.id);
  }

  if (cmdToElementId.size === 0) return si;

  // Rebuild the spatial index with enriched IDs
  const enrichedEntries = si.all.map((entry) => {
    const newId = cmdToElementId.get(entry.id);
    if (newId) {
      return { ...entry, id: newId };
    }
    return entry;
  });

  return new SpatialIndex(enrichedEntries);
}

interface DirtyRect {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

function intersects(entry: { x: number; y: number; width: number; height: number }, rect: DirtyRect): boolean {
  return entry.x + entry.width > rect.x && entry.x < rect.x2 && entry.y + entry.height > rect.y && entry.y < rect.y2;
}

/**
 * Replace only the spatial regions touched by a measure patch.
 *
 * Precise engine bboxes make this independent of command ordering. Structural
 * changes, missing bounds, and degenerate dirty regions conservatively rebuild
 * the full index.
 */
export function updateEnrichedSpatialIndexForPatch(
  previous: SpatialIndex | null,
  previousDisplayList: DisplayList | null,
  displayList: DisplayList,
  score: Score | null,
  patchInfo?: PatchInfo,
): SpatialIndex {
  if (
    !previous ||
    !previousDisplayList?.measureBounds?.length ||
    !displayList.measureBounds?.length ||
    !displayList.elementBboxes?.length ||
    !patchInfo ||
    patchInfo.structuralChange
  ) {
    return buildEnrichedSpatialIndex(displayList, score);
  }

  const changedGlobal = new Set(patchInfo.changedGlobalMeasures);
  const changedParts = patchInfo.changedPartMeasures;
  const isDirtyBound = (bound: NonNullable<DisplayList["measureBounds"]>[number]): boolean =>
    changedGlobal.has(bound.index) || changedParts.get(bound.partIndex)?.includes(bound.index) === true;
  const padding = 128;
  const toRect = (bound: NonNullable<DisplayList["measureBounds"]>[number]): DirtyRect => ({
    x: bound.x - padding,
    y: bound.y - padding,
    x2: bound.x + bound.width + padding,
    y2: bound.y + bound.height + padding,
  });
  const oldRects = previousDisplayList.measureBounds.filter(isDirtyBound).map(toRect);
  const newRects = displayList.measureBounds.filter(isDirtyBound).map(toRect);
  if (oldRects.length === 0 || newRects.length === 0) return buildEnrichedSpatialIndex(displayList, score);

  const dirtyRects = [...oldRects, ...newRects];
  const retained = previous.all.filter((entry) => !dirtyRects.some((rect) => intersects(entry, rect)));
  const dirtyBboxes = displayList.elementBboxes.filter((entry) =>
    newRects.some((rect) => intersects(entry.bbox, rect)),
  );
  const partial = SpatialIndex.fromDisplayList({
    commands: [],
    width: displayList.width,
    height: displayList.height,
    elementBboxes: dirtyBboxes,
  });
  return new SpatialIndex([...retained, ...partial.all]);
}
