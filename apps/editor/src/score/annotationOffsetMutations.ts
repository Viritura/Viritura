/**
 * annotationOffsetMutations — engrave-mode manual placement (manualOffset +
 * avoidCollisions) for movable text annotations: text expressions, dynamics,
 * tempo markings, and rehearsal marks.
 *
 * All four model types carry the same two optional fields:
 *   - `manualOffset?: [dx, dy]` in spatia (sp); +x right, +y up.
 *   - `avoidCollisions?: boolean` — unset/true = auto-flow; false = pinned.
 *
 * A drag sets `avoidCollisions: false` (explicit manual placement) and
 * accumulates the offset; the inspector can toggle the flag or reset both.
 */
import type { Score } from "@viritura/core";
import { resolveAnnotationLocation } from "./ElementPath";
import { produce } from "./scoreClone";

/** The shared shape carried by every movable annotation. */
interface Placeable {
  manualOffset?: [number, number];
  avoidCollisions?: boolean;
}

/** Resolve an element id to its movable annotation object within `score`, or
 *  `null` when the id isn't a movable annotation. Works on a draft or a frozen
 *  score (the produce closure passes its draft). */
function resolvePlaceable(score: Score, elementId: string): Placeable | null {
  const loc = resolveAnnotationLocation(elementId);
  if (!loc) return null;

  if (loc.kind === "part") {
    if (loc.partIndex === undefined) return null;
    const pm = score.parts[loc.partIndex]?.measures[loc.measureIndex];
    if (!pm) return null;
    if ((loc.type === "dyn" || loc.type === "hairpin") && loc.annotationId) {
      return (pm.dynamics?.find((group) => group.id === loc.annotationId) as Placeable | undefined) ?? null;
    }
    if (loc.annotationIndex === undefined) return null;
    if (loc.type === "expr") return (pm.expressions?.[loc.annotationIndex] as Placeable | undefined) ?? null;
    if (loc.type === "dyn") return (pm.dynamics?.[loc.annotationIndex] as Placeable | undefined) ?? null;
    return null;
  }

  // global
  const gm = score.global.measures[loc.measureIndex];
  if (!gm) return null;
  if (loc.type === "tempo") {
    if (loc.annotationIndex === undefined) return null;
    return (gm.tempos?.[loc.annotationIndex] as Placeable | undefined) ?? null;
  }
  if (loc.type === "rehearsal") {
    return (gm.rehearsalMark as Placeable | undefined) ?? null;
  }
  return null;
}

/** True when an element id resolves to a movable annotation (expr/dyn/tempo/
 *  rehearsal). Cheap structural check; does not require a score. */
export function isMovableAnnotationId(elementId: string): boolean {
  const loc = resolveAnnotationLocation(elementId);
  if (!loc) return false;
  if (loc.kind === "part") {
    if ((loc.type === "dyn" || loc.type === "hairpin") && loc.annotationId) return true;
    return (loc.type === "expr" || loc.type === "dyn") && loc.annotationIndex !== undefined;
  }
  if (loc.type === "tempo") return loc.annotationIndex !== undefined;
  return loc.type === "rehearsal";
}

/** Read the current manualOffset (sp) of a movable annotation, or `[0, 0]` if
 *  it has none. Returns `null` when the id doesn't resolve. */
export function getAnnotationOffset(score: Score, elementId: string): [number, number] | null {
  const target = resolvePlaceable(score, elementId);
  if (!target) return null;
  return target.manualOffset ? [target.manualOffset[0], target.manualOffset[1]] : [0, 0];
}

/** Apply an additive drag delta to a movable annotation and pin it
 *  (`avoidCollisions: false`). Clearing the offset to ~0 removes it. */
export function setAnnotationOffsetInScore(score: Score, elementId: string, delta: [number, number]): Score {
  return produce(score, (draft) => {
    const target = resolvePlaceable(draft, elementId);
    if (!target) return;
    // A drag is explicit manual placement: pin so avoidance leaves it put.
    target.avoidCollisions = false;
    const cur = target.manualOffset ?? [0, 0];
    const next: [number, number] = [cur[0] + delta[0], cur[1] + delta[1]];
    if (Math.abs(next[0]) < 1e-6 && Math.abs(next[1]) < 1e-6) {
      delete target.manualOffset;
    } else {
      target.manualOffset = next;
    }
  });
}

/** Replace the manualOffset axis value (inspector numeric entry). */
export function setAnnotationOffsetAxisInScore(score: Score, elementId: string, axis: 0 | 1, value: number): Score {
  return produce(score, (draft) => {
    const target = resolvePlaceable(draft, elementId);
    if (!target) return;
    const cur = target.manualOffset ?? [0, 0];
    const next: [number, number] = axis === 0 ? [value, cur[1]] : [cur[0], value];
    if (Math.abs(next[0]) < 1e-6 && Math.abs(next[1]) < 1e-6) {
      delete target.manualOffset;
    } else {
      target.manualOffset = next;
    }
  });
}

/** Toggle a movable annotation's `avoidCollisions` flag. `true` clears it
 *  (rejoins the auto-flow); `false` pins it. */
export function setAnnotationAvoidCollisionsInScore(score: Score, elementId: string, avoidCollisions: boolean): Score {
  return produce(score, (draft) => {
    const target = resolvePlaceable(draft, elementId);
    if (!target) return;
    // Unset = default true, so only persist the non-default `false`.
    if (avoidCollisions) delete target.avoidCollisions;
    else target.avoidCollisions = false;
  });
}

/** Fully reset a movable annotation to auto placement: clear both the offset
 *  and the avoidCollisions flag. */
export function resetAnnotationPlacementInScore(score: Score, elementId: string): Score {
  return produce(score, (draft) => {
    const target = resolvePlaceable(draft, elementId);
    if (!target) return;
    if (target.manualOffset) delete target.manualOffset;
    if (target.avoidCollisions !== undefined) delete target.avoidCollisions;
  });
}
