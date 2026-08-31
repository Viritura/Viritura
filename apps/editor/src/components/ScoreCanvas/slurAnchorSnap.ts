/**
 * slurAnchorSnap — note-onset snap targets for slur endpoint drags.
 *
 * The spanner drag ruler ([dragSnapPoints]) snaps to *beats*, because a
 * hairpin/pedal/ottava is anchored to a rhythmic position. A slur is anchored
 * to a specific **event**, so its ruler has to carry the event's MNX id rather
 * than a beat fraction.
 */
import type { SpatialIndex } from "@viritura/renderer";
import type { Score, SequenceContent } from "@viritura/core";
import { eventSuffix, eventId as buildEventId } from "../../score/ElementPath";

export interface SlurAnchorPoint {
  /** Engine-space x of the event's notehead column. */
  x: number;
  /** Engine-space y of the event bbox centre, used to disambiguate systems/staves. */
  y: number;
  /** MNX event id — what `slur.target` / the slur's owning event reference. */
  eventId: string;
  measureIndex: number;
}

/** Yield `(content item, flat index)` pairs, descending into containers. */
function* iterateAnchorable(content: readonly SequenceContent[]): Iterable<{ ev: SequenceContent; index: number }> {
  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    if (!item) continue;
    if (item.type === "event") {
      yield { ev: item, index: i };
    } else if ((item.type === "tuplet" || item.type === "tremolo" || item.type === "grace") && item.content) {
      for (let j = 0; j < item.content.length; j++) {
        const inner = item.content[j];
        if (inner?.type === "event") yield { ev: inner, index: j };
      }
    }
  }
}

/**
 * Collect every note-bearing event in `partIndex` that a slur endpoint can
 * anchor to, paired with the x of its rendered notehead column. Events with no
 * MNX id are skipped — the model references anchors by id, so an id-less event
 * cannot be named. (The MNX parser assigns ids on load, so this only excludes
 * synthetic content.)
 */
export function buildSlurAnchorPoints(
  score: Score | null,
  si: SpatialIndex | null,
  partIndex: number,
): SlurAnchorPoint[] {
  if (!score || !si) return [];
  const part = score.parts[partIndex];
  if (!part) return [];

  const points: SlurAnchorPoint[] = [];
  for (let m = 0; m < part.measures.length; m++) {
    const pm = part.measures[m];
    if (!pm) continue;
    for (let s = 0; s < pm.sequences.length; s++) {
      const seq = pm.sequences[s];
      if (!seq) continue;
      for (const { ev, index } of iterateAnchorable(seq.content)) {
        if (ev.type !== "event" || !ev.notes || ev.notes.length === 0) continue;
        const id = ev.id;
        if (!id) continue;
        const bbox = si.getBBox(buildEventId(partIndex, m, s, eventSuffix(id, index, m, s)));
        if (!bbox) continue;
        points.push({
          x: bbox.x + bbox.width / 2,
          y: bbox.y + bbox.height / 2,
          eventId: id,
          measureIndex: m,
        });
      }
    }
  }
  points.sort((a, b) => a.x - b.x);
  return points;
}

/** Nearest anchor to the dragged endpoint, or null when there are no candidates. */
export function nearestSlurAnchor(points: readonly SlurAnchorPoint[], x: number, y: number): SlurAnchorPoint | null {
  let best: SlurAnchorPoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

/**
 * Delta from the endpoint's current note anchor to the candidate nearest the
 * cursor. Applying anchor-to-anchor movement keeps the preview aligned with
 * the placement the layout engine will compute after commit.
 */
export function snappedSlurAnchorDelta(
  points: readonly SlurAnchorPoint[],
  currentEventId: string,
  dragX: number,
  dragY: number,
): { dx: number; dy: number } | null {
  const current = points.find((point) => point.eventId.replace(/\//g, "_") === currentEventId);
  const snapped = nearestSlurAnchor(points, dragX, dragY);
  if (!current || !snapped) return null;
  return { dx: snapped.x - current.x, dy: snapped.y - current.y };
}
