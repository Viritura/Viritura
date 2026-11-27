import type { GlobalLyrics, Part, PartMeasure, Score, SequenceContent } from "@viritura/core";
import type { LyricInputState } from "../components/LyricInput";
import { getEventAncestorId, getEventAtLocation, resolveEventFromSubElement } from "../score/ElementPath";
import type { SelectionState } from "../store/selectionStore";

function collectContentLineIds(content: readonly SequenceContent[], ids: Set<string>): void {
  for (const item of content) {
    if (item.type === "event") {
      for (const id of Object.keys(item.lyrics?.lines ?? {})) ids.add(id);
    } else if (item.type === "tuplet" || item.type === "grace" || item.type === "tremolo") {
      collectContentLineIds(item.content, ids);
    }
  }
}

function contentHasLyrics(content: readonly SequenceContent[]): boolean {
  return content.some((item) => {
    if (item.type === "event") return Object.keys(item.lyrics?.lines ?? {}).length > 0;
    if (item.type === "tuplet" || item.type === "grace" || item.type === "tremolo") {
      return contentHasLyrics(item.content);
    }
    return false;
  });
}

const partLyricPresence = new WeakMap<Part, boolean>();
const measureLyricPresence = new WeakMap<PartMeasure, boolean>();

export function includeLyricLine(score: Score, lineId: string): GlobalLyrics {
  score.global.lyrics ??= { lineOrder: [] };
  if (!score.global.lyrics.lineOrder.includes(lineId)) score.global.lyrics.lineOrder.push(lineId);
  return score.global.lyrics;
}

function measureHasLyrics(measure: PartMeasure): boolean {
  const cached = measureLyricPresence.get(measure);
  if (cached !== undefined) return cached;
  const hasLyrics = measure.sequences.some((sequence) => contentHasLyrics(sequence.content));
  measureLyricPresence.set(measure, hasLyrics);
  return hasLyrics;
}

function partHasLyrics(part: Part): boolean {
  const cached = partLyricPresence.get(part);
  if (cached !== undefined) return cached;
  const hasLyrics = part.measures.some(measureHasLyrics);
  partLyricPresence.set(part, hasLyrics);
  return hasLyrics;
}

/** Invalidate measures that may have been mutated in place by beat repair. */
export function invalidateLyricPresence(score: Score, range?: { start: number; end: number }): void {
  for (const part of score.parts) {
    partLyricPresence.delete(part);
    const start = Math.max(0, range?.start ?? 0);
    const end = Math.min(part.measures.length - 1, range?.end ?? part.measures.length - 1);
    for (let index = start; index <= end; index++) {
      const measure = part.measures[index];
      if (measure) measureLyricPresence.delete(measure);
    }
  }
}

/** Whether the score configures lyric lines or carries any lyric syllables. */
export function scoreHasLyrics(score: Score): boolean {
  const lyrics = score.global.lyrics;
  if ((lyrics?.lineOrder?.length ?? 0) > 0 || Object.keys(lyrics?.lineMetadata ?? {}).length > 0) return true;
  return score.parts.some(partHasLyrics);
}

/** All lyric lines in configured order, followed by any lines found in score content. */
export function getLyricLineIds(score: Score): string[] {
  const configuredOrder = score.global.lyrics?.lineOrder ?? [];
  const ids = new Set(configuredOrder);
  for (const id of Object.keys(score.global.lyrics?.lineMetadata ?? {})) ids.add(id);
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) collectContentLineIds(sequence.content, ids);
    }
  }
  const configured = configuredOrder.filter((id, index) => configuredOrder.indexOf(id) === index);
  const remaining = [...ids]
    .filter((id) => !configured.includes(id))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const ordered = [...configured, ...remaining];
  return ordered.length > 0 ? ordered : ["1"];
}

export function getInitialLyricLineId(score: Score): string {
  return getLyricLineIds(score)[0]!;
}

export function getLyricLineDisplay(score: Score, lineId: string): string {
  const label = score.global.lyrics?.lineMetadata?.[lineId]?.label?.trim();
  if (label) return label;
  const index = getLyricLineIds(score).indexOf(lineId);
  return `Verse ${index >= 0 ? index + 1 : lineId.replace(/^line-/, "")}`;
}

export function getNextLyricLineId(score: Score): string {
  const ids = new Set(getLyricLineIds(score));
  let number = ids.size + 1;
  while (ids.has(String(number))) number++;
  return String(number);
}

/** Resolve a selected note or chord to the event targeted by lyric entry. */
export function createLyricInputState(score: Score, selection: SelectionState, lineId: string): LyricInputState | null {
  if (selection.kind !== "single") return null;
  const location = resolveEventFromSubElement(selection.elementId, score);
  if (!location) return null;
  const event = getEventAtLocation(score, location);
  if (event?.type !== "event" || !event.notes || event.notes.length === 0) return null;
  return { elementId: getEventAncestorId(selection.elementId), lineId };
}

const GRANDFATHERED_TAGS = new Set([
  "art-lojban",
  "cel-gaulish",
  "en-gb-oed",
  "i-ami",
  "i-bnn",
  "i-default",
  "i-enochian",
  "i-hak",
  "i-klingon",
  "i-lux",
  "i-mingo",
  "i-navajo",
  "i-pwn",
  "i-tao",
  "i-tay",
  "i-tsu",
  "no-bok",
  "no-nyn",
  "sgn-be-fr",
  "sgn-be-nl",
  "sgn-ch-de",
  "zh-guoyu",
  "zh-hakka",
  "zh-min",
  "zh-min-nan",
  "zh-xiang",
]);

const LANGUAGE_TAG =
  /^(?:(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4}|[A-Za-z]{5,8})(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?(?:-(?:[A-Za-z0-9]{5,8}|\d[A-Za-z0-9]{3}))*(?:-[0-9A-WY-Za-wy-z](?:-[A-Za-z0-9]{2,8})+)*(?:-x(?:-[A-Za-z0-9]{1,8})+)?|x(?:-[A-Za-z0-9]{1,8})+)$/;

/** Validate BCP 47 syntax without canonicalizing or rewriting the authored tag. */
export function isValidLanguageTag(value: string): boolean {
  const lower = value.toLowerCase();
  if (GRANDFATHERED_TAGS.has(lower)) return true;
  if (!LANGUAGE_TAG.test(value)) return false;
  const subtags = lower.split("-");
  const extensionSingletonIndexes = subtags.flatMap((part, index) =>
    part.length === 1 && part !== "x" && index > 0 ? [index] : [],
  );
  const singletons = extensionSingletonIndexes.map((index) => subtags[index]);
  return new Set(singletons).size === singletons.length;
}
