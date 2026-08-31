/**
 * Builder for `NavigationIndex`. Walks the score model and emits a flat list
 * of `NavigationEntry` rows for events, measure-level annotations, and
 * globally-scoped marks (tempo, rehearsal, jump, volta). Extracted from
 * NavigationIndex.ts to keep both files under the lint thresholds.
 *
 * Element IDs match the Rust engine format:
 *   Events:     p{part}/m{measure}/s{seq}/{event_id}
 *   Clef:       p{part}/m{measure}/clef
 *   Key sig:    p{part}/m{measure}/key
 *   Time sig:   m{measure}/time
 *   Barline:    p{part}/m{measure}/barline
 *   Dynamic:    p{part}/m{measure}/dyn{i}
 *   Hairpin:    p{part}/m{measure}/hairpin{i}
 *   Pedal:      p{part}/m{measure}/pedal{i}
 *   Ottava:     p{part}/m{measure}/ottava{i}
 *   Expression: p{part}/m{measure}/expr{i}
 *   Chord sym:  p{part}/m{measure}/chord{i}
 *   Tempo:      m{measure}/tempo{i}
 *   Rehearsal:  m{measure}/rehearsal
 *   Jump:       m{measure}/jump0
 *   Volta:      m{measure}/volta
 */

import type { Score } from "@viritura/core";
import { isRest } from "@viritura/core";
import { DURATION_BEATS } from "@viritura/core";
import type { SelectableElementType } from "../score/elementTypes";
import {
  eventId,
  eventSuffix,
  clefId,
  keySigId,
  barlineId,
  timeSigId,
  tempoId,
  rehearsalId,
  jumpId,
  voltaId,
  dynamicId,
  hairpinId,
  pedalId,
  ottavaId,
  expressionId,
  chordSymbolId,
} from "../score/ElementPath";
import type { NavigationEntry, NavigationIndex } from "./NavigationIndex";

// ═══════════════════════════════════════════
// Sort keys for ordering elements within a measure.
// Lower values sort first.
// ═══════════════════════════════════════════
const SORT_KEY_CLEF = -3;
const SORT_KEY_KEY_SIG = -2;
const SORT_KEY_TIME_SIG = -1;
const SORT_KEY_BARLINE = 100_000;

function fractionToSortKey(fraction: [number, number]): number {
  // MNX rhythmic positions are fractions of a whole note; event cursors use
  // quarter-note beats, so normalize both onto the same timeline.
  return (fraction[0] / fraction[1]) * 4;
}

function eventBeats(event: { duration: { base: string; dots?: number } }): number {
  let beats = DURATION_BEATS[event.duration.base as keyof typeof DURATION_BEATS] ?? 1;
  if (event.duration.dots) {
    let dotValue = beats / 2;
    for (let d = 0; d < event.duration.dots; d++) {
      beats += dotValue;
      dotValue /= 2;
    }
  }
  return beats;
}

// ───────────────────────────────────────────
// Generic push helpers
// ───────────────────────────────────────────

interface NonEventArgs {
  elementId: string;
  elementType: SelectableElementType;
  partIndex: number;
  measureIndex: number;
  sortKey: number;
}

function pushNonEvent(entries: NavigationEntry[], args: NonEventArgs): void {
  entries.push({
    elementId: args.elementId,
    elementType: args.elementType,
    partIndex: args.partIndex,
    measureIndex: args.measureIndex,
    sequenceIndex: -1,
    eventIndex: -1,
    isRest: false,
    sortKey: args.sortKey,
  });
}

// ───────────────────────────────────────────
// Global entries (partIndex = -1)
// ───────────────────────────────────────────

function pushGlobalTempos(
  entries: NavigationEntry[],
  m: number,
  tempos: NonNullable<Score["global"]["measures"][number]>["tempos"],
): void {
  if (!tempos) return;
  for (let i = 0; i < tempos.length; i++) {
    const tempo = tempos[i]!;
    const sk = tempo.location ? fractionToSortKey(tempo.location.fraction) : 0;
    pushNonEvent(entries, {
      elementId: tempoId(m, i),
      elementType: "tempo",
      partIndex: -1,
      measureIndex: m,
      sortKey: sk,
    });
  }
}

function collectGlobalEntries(score: Score, entries: NavigationEntry[]): void {
  for (let m = 0; m < score.global.measures.length; m++) {
    const gm = score.global.measures[m];
    if (!gm) continue;

    if (gm.time) {
      pushNonEvent(entries, {
        elementId: timeSigId(m),
        elementType: "time-signature",
        partIndex: -1,
        measureIndex: m,
        sortKey: SORT_KEY_TIME_SIG,
      });
    }
    pushGlobalTempos(entries, m, gm.tempos);
    if (gm.rehearsalMark) {
      pushNonEvent(entries, {
        elementId: rehearsalId(m),
        elementType: "rehearsal",
        partIndex: -1,
        measureIndex: m,
        sortKey: -0.5,
      });
    }
    if (gm.jump) {
      pushNonEvent(entries, {
        elementId: jumpId(m),
        elementType: "jump",
        partIndex: -1,
        measureIndex: m,
        sortKey: SORT_KEY_BARLINE + 1,
      });
    }
    if (gm.ending) {
      pushNonEvent(entries, {
        elementId: voltaId(m),
        elementType: "volta",
        partIndex: -1,
        measureIndex: m,
        sortKey: -0.5,
      });
    }
  }
}

// ───────────────────────────────────────────
// Per-part: clef / key / barline
// ───────────────────────────────────────────

function collectPartHeaders(
  score: Score,
  p: number,
  m: number,
  measure: NonNullable<NonNullable<Score["parts"][number]>["measures"][number]>,
  entries: NavigationEntry[],
): void {
  if (measure.clefs && measure.clefs.length > 0) {
    pushNonEvent(entries, {
      elementId: clefId(p, m),
      elementType: "clef",
      partIndex: p,
      measureIndex: m,
      sortKey: SORT_KEY_CLEF,
    });
  }
  const gm = score.global.measures[m];
  if (gm?.key) {
    pushNonEvent(entries, {
      elementId: keySigId(p, m),
      elementType: "key-signature",
      partIndex: p,
      measureIndex: m,
      sortKey: SORT_KEY_KEY_SIG,
    });
  }
  if (gm?.barline) {
    pushNonEvent(entries, {
      elementId: barlineId(m),
      elementType: "barline",
      partIndex: p,
      measureIndex: m,
      sortKey: SORT_KEY_BARLINE,
    });
  }
}

// ───────────────────────────────────────────
// Per-part: events (with tuplet/tremolo inner-event flattening)
// ───────────────────────────────────────────

interface EventCursorContext {
  p: number;
  m: number;
  s: number;
}

interface TupletContainer {
  type: "tuplet" | "tremolo";
  outer: { duration: { base: string; dots?: number }; multiple: number };
  inner: { duration: { base: string; dots?: number }; multiple: number };
  content: ({ type?: string; duration?: unknown; notes?: unknown } | null | undefined)[];
}

function pushTupletInnerEvents(
  ctx: EventCursorContext,
  container: TupletContainer,
  outerEventIndex: number,
  beatPosition: number,
  flatCounter: { value: number },
  entries: NavigationEntry[],
): number {
  const outerBeats = eventBeats({ duration: container.outer.duration }) * container.outer.multiple;
  const innerBeats =
    container.type === "tuplet"
      ? eventBeats({ duration: container.inner.duration }) * container.inner.multiple
      : outerBeats;
  const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
  let innerBeatPos = beatPosition;

  for (let j = 0; j < container.content.length; j++) {
    const inner = container.content[j];
    if (!inner) {
      flatCounter.value++;
      continue;
    }
    const innerSuffix = eventSuffix((inner as { id?: string }).id, flatCounter.value);
    const innerIsRest = inner.type === "event" ? isRest(inner as never) : false;
    entries.push({
      elementId: eventId(ctx.p, ctx.m, ctx.s, innerSuffix),
      elementType: innerIsRest ? "rest" : "event",
      partIndex: ctx.p,
      measureIndex: ctx.m,
      sequenceIndex: ctx.s,
      eventIndex: j,
      tupletIndex: outerEventIndex,
      isRest: innerIsRest,
      sortKey: innerBeatPos,
    });
    if (inner.type === "event") {
      innerBeatPos += eventBeats(inner as { duration: { base: string; dots?: number } }) * scale;
    }
    flatCounter.value++;
  }
  return outerBeats;
}

function pushSingleEvent(
  ctx: EventCursorContext,
  event: { type: string; id?: string; duration: { base: string; dots?: number } },
  e: number,
  beatPosition: number,
  flatCounter: { value: number },
  entries: NavigationEntry[],
): number {
  if (event.type === "event") {
    const evSuffix = eventSuffix(event.id, e, ctx.m, ctx.s);
    const eventIsRest = isRest(event as never);
    entries.push({
      elementId: eventId(ctx.p, ctx.m, ctx.s, evSuffix),
      elementType: eventIsRest ? "rest" : "event",
      partIndex: ctx.p,
      measureIndex: ctx.m,
      sequenceIndex: ctx.s,
      eventIndex: e,
      isRest: eventIsRest,
      sortKey: beatPosition,
    });
    flatCounter.value++;
    return eventBeats(event);
  }
  // Grace notes: use content-array index for ID (Rust doesn't count them in e{N})
  const evSuffix = eventSuffix(event.id, e, ctx.m, ctx.s);
  entries.push({
    elementId: eventId(ctx.p, ctx.m, ctx.s, evSuffix),
    elementType: "event",
    partIndex: ctx.p,
    measureIndex: ctx.m,
    sequenceIndex: ctx.s,
    eventIndex: e,
    isRest: false,
    sortKey: beatPosition,
  });
  return 0; // Grace notes don't advance beat position
}

function collectSequenceEvents(
  ctx: EventCursorContext,
  seq: NonNullable<NonNullable<NonNullable<Score["parts"][number]>["measures"][number]>["sequences"][number]>,
  entries: NavigationEntry[],
): void {
  let beatPosition = 0;
  // Flat counter matching the Rust engine's e{N} numbering scheme.
  const flatCounter = { value: 0 };

  for (let e = 0; e < seq.content.length; e++) {
    const event = seq.content[e];
    if (!event || event.type === "space") {
      if (event) {
        beatPosition +=
          ((event as { duration: [number, number] }).duration[0] /
            (event as { duration: [number, number] }).duration[1]) *
          4;
      }
      continue;
    }
    if (event.type === "tuplet" || event.type === "tremolo") {
      beatPosition += pushTupletInnerEvents(
        ctx,
        event as unknown as TupletContainer,
        e,
        beatPosition,
        flatCounter,
        entries,
      );
    } else {
      beatPosition += pushSingleEvent(
        ctx,
        event as { type: string; id?: string; duration: { base: string; dots?: number } },
        e,
        beatPosition,
        flatCounter,
        entries,
      );
    }
  }
}

function collectEventEntries(
  p: number,
  m: number,
  measure: NonNullable<NonNullable<Score["parts"][number]>["measures"][number]>,
  entries: NavigationEntry[],
): void {
  for (let s = 0; s < measure.sequences.length; s++) {
    const seq = measure.sequences[s];
    if (!seq) continue;
    collectSequenceEvents({ p, m, s }, seq, entries);
  }
}

// ───────────────────────────────────────────
// Per-part: positioned annotations (dynamics, hairpins, pedals, ottavas, expressions, chord symbols)
// ───────────────────────────────────────────

interface PositionedItem {
  position: { fraction: [number, number] };
}

function pushPositionedItems<T extends PositionedItem>(
  items: T[] | undefined,
  p: number,
  m: number,
  elementType: SelectableElementType,
  makeId: (p: number, m: number, i: number) => string,
  entries: NavigationEntry[],
): void {
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    pushNonEvent(entries, {
      elementId: makeId(p, m, i),
      elementType,
      partIndex: p,
      measureIndex: m,
      sortKey: fractionToSortKey(item.position.fraction),
    });
  }
}

function collectPartAnnotations(
  p: number,
  m: number,
  measure: NonNullable<NonNullable<Score["parts"][number]>["measures"][number]>,
  entries: NavigationEntry[],
): void {
  if (measure.dynamics) {
    for (const group of measure.dynamics) {
      const gradual = group.type === "gradual";
      pushNonEvent(entries, {
        elementId: gradual ? hairpinId(p, m, group.id) : dynamicId(p, m, group.id),
        elementType: gradual ? "hairpin" : "dynamic",
        partIndex: p,
        measureIndex: m,
        sortKey: fractionToSortKey(group.position.fraction),
      });
    }
  }
  pushPositionedItems(measure.pedals, p, m, "pedal", pedalId, entries);
  pushPositionedItems(measure.ottavas, p, m, "ottava", ottavaId, entries);
  pushPositionedItems(measure.expressions, p, m, "expression", expressionId, entries);
  pushPositionedItems(measure.chordSymbols, p, m, "chord-symbol", chordSymbolId, entries);
}

// ───────────────────────────────────────────
// Per-part: orchestrator
// ───────────────────────────────────────────

function collectPartEntries(score: Score, p: number, entries: NavigationEntry[]): void {
  const part = score.parts[p];
  if (!part) return;
  for (let m = 0; m < part.measures.length; m++) {
    const measure = part.measures[m];
    if (!measure) continue;
    collectPartHeaders(score, p, m, measure, entries);
    collectEventEntries(p, m, measure, entries);
    collectPartAnnotations(p, m, measure, entries);
  }
}

// ───────────────────────────────────────────
// Top-level entry point
// ───────────────────────────────────────────

function sortEntries(entries: NavigationEntry[]): void {
  // Global entries (partIndex -1) sort before part 0.
  entries.sort((a, b) => {
    if (a.partIndex !== b.partIndex) return a.partIndex - b.partIndex;
    if (a.measureIndex !== b.measureIndex) return a.measureIndex - b.measureIndex;
    return a.sortKey - b.sortKey;
  });
}

export function buildNavigationIndex(score: Score): NavigationIndex {
  const entries: NavigationEntry[] = [];
  collectGlobalEntries(score, entries);
  for (let p = 0; p < score.parts.length; p++) {
    collectPartEntries(score, p, entries);
  }
  sortEntries(entries);
  return { entries };
}
