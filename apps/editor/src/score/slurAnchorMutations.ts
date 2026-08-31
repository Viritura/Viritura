/**
 * slurAnchorMutations — engrave-mode re-anchoring of slur endpoints.
 *
 * Distinct from `slurShapeMutations`, which nudges the *drawn curve* by sp
 * offsets without changing what the slur spans. Re-anchoring rewrites the
 * model: dragging `p0` moves the slur onto a different source event, dragging
 * `p3` repoints `slur.target`.
 */

import { walkSequenceEvents, type NoteEvent, type Score, type Slur } from "@viritura/core";
import { produce } from "./scoreClone";
import { iterateNoteEvents, parseSlurElementId } from "./slurShapeMutations";

type SlurEntry = NonNullable<NoteEvent["slurs"]>[number];

export interface SlurAnchorInfo {
  /** Part that owns the slur's source event — scopes the snap ruler. */
  partIndex: number;
  sourceEventId: string;
  targetEventId: string;
}

/** Element id produced after moving one endpoint of a slur. */
export function reanchoredSlurElementId(
  score: Score,
  slurElementId: string,
  end: "start" | "end",
  newEventId: string,
): string | null {
  const endpoints = canonicalReanchoredEndpoints(score, slurElementId, end, newEventId);
  if (!endpoints) return null;
  return `slur/${endpoints.source.replace(/\//g, "_")}/${endpoints.target.replace(/\//g, "_")}`;
}

/**
 * Locate the part a slur lives in, plus its current endpoint event ids.
 * Returns null when the element id doesn't parse or the slur isn't found.
 */
export function findSlurAnchorInfo(score: Score, slurElementId: string): SlurAnchorInfo | null {
  const parsed = parseSlurElementId(slurElementId);
  if (!parsed) return null;
  for (let p = 0; p < score.parts.length; p++) {
    for (const pm of score.parts[p]!.measures) {
      for (const seq of pm.sequences) {
        for (const ev of iterateNoteEvents(seq)) {
          if (ev.id !== parsed.src || !ev.slurs) continue;
          if (ev.slurs.some((s) => s.target === parsed.target)) {
            return { partIndex: p, sourceEventId: parsed.src, targetEventId: parsed.target };
          }
        }
      }
    }
  }
  return null;
}

/** Drop a per-handle shape override that a re-anchor has invalidated. */
function dropHandleOverride(slur: SlurEntry, handle: "p0" | "p3"): void {
  const shape = slur.shape;
  if (!shape) return;
  if (shape[handle]) delete shape[handle];
  if (Object.keys(shape).length === 0) delete slur.shape;
}

interface CanonicalEndpoints {
  source: string;
  target: string;
  inverted: boolean;
}

function eventOrderInPart(score: Score, partIndex: number): Map<string, number> {
  const order = new Map<string, number>();
  const part = score.parts[partIndex];
  if (!part) return order;
  let rank = 0;
  for (const measure of part.measures) {
    for (const sequence of measure.sequences) {
      for (const { event } of walkSequenceEvents(sequence.content)) {
        if (event.id && !order.has(event.id)) order.set(event.id, rank++);
      }
    }
  }
  return order;
}

function canonicalReanchoredEndpoints(
  score: Score,
  slurElementId: string,
  end: "start" | "end",
  newEventId: string,
): CanonicalEndpoints | null {
  const parsed = parseSlurElementId(slurElementId);
  const info = findSlurAnchorInfo(score, slurElementId);
  if (!parsed || !info || newEventId === parsed.src || newEventId === parsed.target) return null;
  const requestedSource = end === "start" ? newEventId : info.sourceEventId;
  const requestedTarget = end === "end" ? newEventId : info.targetEventId;
  const order = eventOrderInPart(score, info.partIndex);
  const sourceRank = order.get(requestedSource);
  const targetRank = order.get(requestedTarget);
  if (sourceRank === undefined || targetRank === undefined || sourceRank === targetRank) return null;
  return sourceRank < targetRank
    ? { source: requestedSource, target: requestedTarget, inverted: false }
    : { source: requestedTarget, target: requestedSource, inverted: true };
}

function swapOptional(slur: Slur, startKey: "startNote" | "side", endKey: "endNote" | "sideEnd"): void {
  const start = slur[startKey];
  const end = slur[endKey];
  if (end === undefined) delete slur[startKey];
  else Object.assign(slur, { [startKey]: end });
  if (start === undefined) delete slur[endKey];
  else Object.assign(slur, { [endKey]: start });
}

function reverseSlur(slur: Slur): void {
  swapOptional(slur, "startNote", "endNote");
  swapOptional(slur, "side", "sideEnd");
  const shape = slur.shape;
  if (!shape) return;
  slur.shape = {
    ...(shape.p3 ? { p0: shape.p3 } : {}),
    ...(shape.p2 ? { p1: shape.p2 } : {}),
    ...(shape.p1 ? { p2: shape.p1 } : {}),
    ...(shape.p0 ? { p3: shape.p0 } : {}),
  };
  if (Object.keys(slur.shape).length === 0) delete slur.shape;
}

/**
 * Re-anchor one end of a slur onto `newEventId`.
 *
 * - `"end"` repoints `slur.target`.
 * - `"start"` moves the whole slur entry onto the new source event.
 *
 * The matching `startNote` / `endNote` note-level anchor and the matching
 * `p0` / `p3` shape override are cleared, since both were expressed relative
 * to the endpoint that just moved. Returns the original score when the id
 * doesn't resolve or the move would collapse the slur onto a single event.
 */
export function reanchorSlurInScore(
  score: Score,
  slurElementId: string,
  end: "start" | "end",
  newEventId: string,
): Score {
  const parsed = parseSlurElementId(slurElementId);
  const endpoints = canonicalReanchoredEndpoints(score, slurElementId, end, newEventId);
  if (!parsed || !endpoints) return score;
  const { src, target } = parsed;

  return produce(score, (draft) => {
    let sourceEvent: NoteEvent | undefined;
    let slurIndex = -1;
    let canonicalSourceEvent: NoteEvent | undefined;

    for (const part of draft.parts) {
      for (const pm of part.measures) {
        for (const seq of pm.sequences) {
          for (const ev of iterateNoteEvents(seq)) {
            if (ev.id === endpoints.source) canonicalSourceEvent = ev;
            if (ev.id !== src || !ev.slurs) continue;
            const i = ev.slurs.findIndex((s) => s.target === target);
            if (i >= 0) {
              sourceEvent = ev;
              slurIndex = i;
            }
          }
        }
      }
    }

    const slurs = sourceEvent?.slurs;
    if (!slurs || slurIndex < 0 || !canonicalSourceEvent) return;
    const slur = slurs[slurIndex]!;

    if (end === "end") {
      if (slur.endNote) delete slur.endNote;
      dropHandleOverride(slur, "p3");
    } else {
      if (slur.startNote) delete slur.startNote;
      dropHandleOverride(slur, "p0");
    }
    if (endpoints.inverted) reverseSlur(slur);
    slur.target = endpoints.target;
    if (canonicalSourceEvent === sourceEvent) return;
    slurs.splice(slurIndex, 1);
    if (slurs.length === 0) delete sourceEvent!.slurs;
    if (canonicalSourceEvent.slurs) canonicalSourceEvent.slurs.push(slur);
    else canonicalSourceEvent.slurs = [slur];
  });
}
