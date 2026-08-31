/**
 * slurShapeMutations — engrave-mode overrides to per-handle slur shapes.
 *
 * Slurs are identified by element ids of the form `slur/{src}/{target}`,
 * where `src` / `target` are sanitized MNX event ids. The functions here
 * locate the matching NoteEvent in the score and accumulate / replace /
 * clear the `_x.viritura` SlurShape control-point deltas on it.
 */

import type { NoteEvent, Score, Sequence, SlurShape } from "@viritura/core";
import { produce } from "../score/scoreClone";

/**
 * Parse a slur element id of the form `slur/{srcMnxEventId}/{targetMnxEventId}`
 * (segments are sanitized — any '/' in the original MNX id was replaced with '_').
 * Returns null if the id does not look like a slur element id.
 *
 * Folder-internal: shared with `slurAnchorMutations`, not part of the
 * `ScoreMutations` barrel.
 */
export function parseSlurElementId(elementId: string): { src: string; target: string } | null {
  if (!elementId.startsWith("slur/")) return null;
  const parts = elementId.split("/");
  if (parts.length < 3) return null;
  return { src: parts[1]!, target: parts[2]! };
}

/**
 * Iterate every NoteEvent in a sequence, descending into tuplet, tremolo and
 * grace containers. Grace notes matter here because the layout engine treats
 * them as slur sources in their own right (`render_slurs` collects
 * `grace_notes(i).event.slurs`), so a slur anchored to a grace note is drawn
 * and selectable — and without this traversal every shape mutation on it
 * would silently no-op.
 *
 * Folder-internal: shared with `slurAnchorMutations`, not part of the
 * `ScoreMutations` barrel.
 */
export function* iterateNoteEvents(seq: Sequence): Iterable<NoteEvent> {
  for (const item of seq.content) {
    if (item.type === "event") {
      yield item;
    } else if ((item.type === "tuplet" || item.type === "tremolo" || item.type === "grace") && item.content) {
      for (const c of item.content) {
        if (c.type === "event") yield c;
        else if (c.type === "grace" && c.content) {
          for (const g of c.content) if (g.type === "event") yield g;
        }
      }
    }
  }
}

/** Compose two `[dx, dy]` sp deltas (additive). */
function addDelta(
  existing: [number, number] | undefined,
  next: [number, number] | undefined,
): [number, number] | undefined {
  if (!existing) return next;
  if (!next) return existing;
  return [existing[0] + next[0], existing[1] + next[1]];
}

/** Locate a slur on a NoteEvent given source-event id + slur target id. */
function findSlurOn(
  score: Score,
  src: string,
  target: string,
): { ev: NoteEvent; slur: NonNullable<NoteEvent["slurs"]>[number] } | null {
  for (const part of score.parts) {
    for (const pm of part.measures) {
      for (const seq of pm.sequences) {
        for (const ev of iterateNoteEvents(seq)) {
          if (ev.id !== src || !ev.slurs) continue;
          const slur = ev.slurs.find((s) => s.target === target);
          if (slur) return { ev, slur };
        }
      }
    }
  }
  return null;
}

/**
 * Walk the produce draft and invoke `mutate` on the matching slur. Mirrors
 * `findSlurOn` but operates on the writable draft.
 */
function mutateSlur(
  score: Score,
  src: string,
  target: string,
  mutate: (slur: NonNullable<NoteEvent["slurs"]>[number]) => void,
): Score {
  return produce(score, (draft) => {
    for (const part of draft.parts) {
      for (const pm of part.measures) {
        for (const seq of pm.sequences) {
          for (const ev of iterateNoteEvents(seq)) {
            if (ev.id !== src || !ev.slurs) continue;
            const slur = ev.slurs.find((s) => s.target === target);
            if (!slur) continue;
            mutate(slur);
            return;
          }
        }
      }
    }
  });
}

/** Strip undefined entries so the serializer emits a tight object. */
function compactShape(shape: SlurShape): SlurShape {
  const out: SlurShape = {};
  for (const k of ["p0", "p1", "p2", "p3"] as const) {
    const v = shape[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Apply an engrave-mode slur shape override. `delta` carries per-handle
 * `[dx, dy]` sp values that are *added* to the slur's existing shape so
 * successive drags accumulate.
 */
export function setSlurShapeInScore(score: Score, slurElementId: string, delta: SlurShape): Score {
  const parsed = parseSlurElementId(slurElementId);
  if (!parsed) return score;
  return mutateSlur(score, parsed.src, parsed.target, (slur) => {
    const cur: SlurShape = slur.shape ?? {};
    const merged = compactShape({
      p0: addDelta(cur.p0, delta.p0),
      p1: addDelta(cur.p1, delta.p1),
      p2: addDelta(cur.p2, delta.p2),
      p3: addDelta(cur.p3, delta.p3),
    });
    if (Object.keys(merged).length === 0) {
      delete slur.shape;
    } else {
      slur.shape = merged;
    }
  });
}

/**
 * Remove all per-handle shape overrides from the slur identified by
 * `slurElementId`. Used by the engrave-mode "Reset shape" context menu.
 */
export function clearSlurShapeInScore(score: Score, slurElementId: string): Score {
  const parsed = parseSlurElementId(slurElementId);
  if (!parsed) return score;
  return mutateSlur(score, parsed.src, parsed.target, (slur) => {
    if (slur.shape) delete slur.shape;
  });
}

/**
 * Look up the `SlurShape` overrides (if any) for the slur identified by the
 * given element id. Returns `null` when the id cannot be parsed or the slur
 * isn't found. Returns an empty object `{}` when the slur exists but has no
 * shape overrides (useful so callers can distinguish "no slur" from
 * "slur with defaults").
 */
export function getSlurShapeFromScore(score: Score, slurElementId: string): SlurShape | null {
  const parsed = parseSlurElementId(slurElementId);
  if (!parsed) return null;
  const hit = findSlurOn(score, parsed.src, parsed.target);
  if (!hit) return null;
  return hit.slur.shape ?? {};
}

/**
 * Replace (rather than add to) the slur's `SlurShape` overrides. Used by the
 * engrave-mode properties panel when the user types numeric values directly.
 * Pass an empty object to clear all overrides.
 */
export function replaceSlurShapeInScore(score: Score, slurElementId: string, shape: SlurShape): Score {
  const parsed = parseSlurElementId(slurElementId);
  if (!parsed) return score;
  return mutateSlur(score, parsed.src, parsed.target, (slur) => {
    const trimmed: SlurShape = {};
    for (const k of ["p0", "p1", "p2", "p3"] as const) {
      const v = shape[k];
      if (v !== undefined) trimmed[k] = [v[0], v[1]];
    }
    if (Object.keys(trimmed).length === 0) {
      delete slur.shape;
    } else {
      slur.shape = trimmed;
    }
  });
}
