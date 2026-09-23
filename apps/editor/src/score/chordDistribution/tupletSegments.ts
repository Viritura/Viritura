/**
 * Splitting a distribution timeline at tuplet boundaries.
 *
 * The beat grid flattens content onto a union of onsets and re-notates it with
 * ordinary note values. Tuplets cannot survive that: a triplet eighth is a
 * third of a beat and no plain duration spells it. So a tuplet is distributed
 * as a unit instead — its interior is its own timeline, redistributed
 * recursively, and each destination staff receives a copy of the tuplet
 * container wrapping its share of the interior.
 *
 * That only works when the sources agree about where the tuplets are. Two
 * flutes playing the same triplet figure align exactly and reduce cleanly; a
 * triplet sounding against a straight half note has no correct re-notation, so
 * it is refused rather than silently re-barred.
 */

import { isRest, type SequenceContent, type Tuplet } from "@viritura/core";
import { sequenceContentBeats } from "../../commands/noteCommands";
import { buildBeatGrid, tupletRhythm, type BeatGrid, type ContentGridSource, type RhythmContext } from "./beatGrid";
import { FragmentDistributionError } from "./distributionError";

const EPSILON = 1e-9;

/** A stretch of the timeline distributed as one unit. */
export type DistributionSegment =
  | { kind: "plain"; grid: BeatGrid; rhythm: RhythmContext }
  | {
      kind: "tuplet";
      template: Tuplet;
      outerBeats: number;
      inner: DistributionSegment[];
      innerRhythm: RhythmContext;
    };

interface PlacedItem {
  start: number;
  end: number;
  item: SequenceContent;
}

interface Span {
  start: number;
  end: number;
}

function round(beat: number): number {
  return Math.round(beat * 1e6) / 1e6;
}

function placeItems(source: ContentGridSource): PlacedItem[] {
  const placed: PlacedItem[] = [];
  let beat = source.leadInBeats;
  for (const item of source.content) {
    const beats = sequenceContentBeats(item);
    placed.push({ start: round(beat), end: round(beat + beats), item });
    beat += beats;
  }
  return placed;
}

function overlaps(placed: PlacedItem, span: Span): boolean {
  return placed.start < span.end - EPSILON && placed.end > span.start + EPSILON;
}

function collectSpans(placements: readonly PlacedItem[][]): Span[] {
  const spans = new Map<string, Span>();
  for (const placed of placements) {
    for (const entry of placed) {
      if (entry.item.type === "tuplet")
        spans.set(`${entry.start}:${entry.end}`, { start: entry.start, end: entry.end });
    }
  }
  const ordered = [...spans.values()].sort((left, right) => left.start - right.start);
  for (const [index, span] of ordered.entries()) {
    const next = ordered[index + 1];
    if (next && next.start < span.end - EPSILON) {
      throw new FragmentDistributionError(
        "Nothing was redistributed: the copied staves place tuplets differently, so there is no shared rhythm to merge.",
      );
    }
  }
  return ordered;
}

function sameTupletShape(left: Tuplet, right: Tuplet): boolean {
  return (
    left.inner.multiple === right.inner.multiple &&
    left.outer.multiple === right.outer.multiple &&
    JSON.stringify(left.inner.duration) === JSON.stringify(right.inner.duration) &&
    JSON.stringify(left.outer.duration) === JSON.stringify(right.outer.duration)
  );
}

/**
 * The tuplet each source contributes to `span`, or undefined when the source is
 * silent there. Anything else is unmergeable.
 */
function tupletAtSpan(placed: readonly PlacedItem[], span: Span): Tuplet | undefined {
  const inside = placed.filter((entry) => overlaps(entry, span));
  if (inside.length === 0) return undefined;
  const [first] = inside;
  if (
    inside.length === 1 &&
    first!.item.type === "tuplet" &&
    Math.abs(first!.start - span.start) < EPSILON &&
    Math.abs(first!.end - span.end) < EPSILON
  ) {
    return first!.item;
  }
  const allRests = inside.every((entry) => entry.item.type === "event" && isRest(entry.item));
  if (allRests) return undefined;
  throw new FragmentDistributionError(
    "Nothing was redistributed: a tuplet sounds against unmatched rhythm on another staff. Copy staves whose tuplets line up.",
  );
}

function tupletSegment(placements: readonly PlacedItem[][], span: Span, rhythm: RhythmContext): DistributionSegment {
  const tuplets = placements.map((placed) => tupletAtSpan(placed, span));
  const template = tuplets.find((tuplet) => tuplet !== undefined);
  if (!template) throw new FragmentDistributionError("Nothing was redistributed: the tuplet span has no content.");
  if (tuplets.some((tuplet) => tuplet && !sameTupletShape(tuplet, template))) {
    throw new FragmentDistributionError(
      "Nothing was redistributed: the copied staves use different tuplet ratios over the same beats.",
    );
  }
  const inner = tuplets.map<ContentGridSource>((tuplet) => ({ content: tuplet?.content ?? [], leadInBeats: 0 }));
  const innerRhythm = tupletRhythm(rhythm.timeSignature);
  return {
    kind: "tuplet",
    template,
    outerBeats: span.end - span.start,
    inner: buildSegments(inner, innerRhythm),
    innerRhythm,
  };
}

function plainSegment(placements: readonly PlacedItem[][], span: Span, rhythm: RhythmContext): DistributionSegment {
  const sources = placements.map<ContentGridSource>((placed) => {
    const inside = placed.filter((entry) => entry.start >= span.start - EPSILON && entry.end <= span.end + EPSILON);
    return {
      content: inside.map((entry) => entry.item),
      leadInBeats: inside.length > 0 ? Math.max(0, inside[0]!.start - span.start) : 0,
    };
  });
  // Slot beats are segment-relative, so the segment's rhythm has to know where
  // the segment itself starts for barlines to land in the right place.
  const segmentRhythm: RhythmContext = { ...rhythm, startBeat: rhythm.startBeat + span.start };
  const grid = buildBeatGrid(sources, segmentRhythm);
  if (!grid) {
    throw new FragmentDistributionError("Nothing was redistributed: tremolos and grace notes are not supported yet.");
  }
  return { kind: "plain", grid, rhythm: segmentRhythm };
}

/** Split aligned source timelines into plain runs and whole tuplets. */
export function buildSegments(sources: readonly ContentGridSource[], rhythm: RhythmContext): DistributionSegment[] {
  const placements = sources.map(placeItems);
  const duration = round(Math.max(0, ...placements.map((placed) => placed.at(-1)?.end ?? 0)));
  const spans = collectSpans(placements);
  if (spans.length === 0) return [plainSegment(placements, { start: 0, end: duration }, rhythm)];

  const segments: DistributionSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor + EPSILON)
      segments.push(plainSegment(placements, { start: cursor, end: span.start }, rhythm));
    segments.push(tupletSegment(placements, span, rhythm));
    cursor = span.end;
  }
  if (duration > cursor + EPSILON) segments.push(plainSegment(placements, { start: cursor, end: duration }, rhythm));
  return segments;
}

/** The largest simultaneity anywhere in the segmented timeline. */
export function segmentsMaxSimultaneity(segments: readonly DistributionSegment[]): number {
  return segments.reduce((maximum, segment) => {
    const count =
      segment.kind === "plain"
        ? segment.grid.slots.reduce((inner, slot) => Math.max(inner, slot.notes.length), 0)
        : segmentsMaxSimultaneity(segment.inner);
    return Math.max(maximum, count);
  }, 0);
}
