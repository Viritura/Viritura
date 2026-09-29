/**
 * textFrameMutations — pure edits of `ScoreDefinition.textFrames` for one
 * score view (full score or part). Array order is paint order: later frames
 * are drawn on top, so layer-order commands reorder the array.
 */

import {
  textContentFromPlain,
  type Score,
  type ScoreDefinition,
  type SequenceContent,
  type TextContent,
  type TextFrame,
  type TextFrameLocator,
  type TextFramePageAnchor,
  type TextFrameWidth,
} from "@viritura/core";
import { withScoreDef } from "./scoreDefHelpers";
import { scoreLayoutContainsPart } from "./scoreMembership";

export type TextFrameLayerCommand = "forward" | "backward" | "front" | "back";

/** Default geometry for a newly created frame: top-left of its page, 20 staff spaces wide. */
const DEFAULT_TEXT_FRAME_WIDTH: TextFrameWidth = { unit: "staffSpaces", value: 20 };
const DEFAULT_TEXT_FRAME_ANCHOR: TextFramePageAnchor = "top-left";

/** Frames of one score view, in paint order. */
export function textFramesForScore(score: Score | null | undefined, scoreIndex: number): readonly TextFrame[] {
  return score?.scores?.[scoreIndex]?.textFrames ?? [];
}

/** Next unused `tf{n}` ID. Frame IDs are unique across every score view of the document. */
export function nextTextFrameId(score: Score): string {
  const used = new Set((score.scores ?? []).flatMap((sd) => (sd.textFrames ?? []).map((frame) => frame.id)));
  let n = used.size + 1;
  while (used.has(`tf${n}`)) n++;
  return `tf${n}`;
}

export interface NewTextFrameOptions {
  locator: TextFrameLocator;
  text?: string;
  id?: string;
  anchor?: TextFramePageAnchor;
  offset?: { x: number; y: number };
  width?: TextFrameWidth;
}

/** Build a frame with editor defaults; does not insert it. */
export function buildTextFrame(score: Score, options: NewTextFrameOptions): TextFrame {
  return {
    // A blank ID would fail the whole document parse, so fall back to a generated one.
    id: options.id?.trim() ? options.id : nextTextFrameId(score),
    locator: options.locator,
    placement: {
      anchor: options.anchor ?? DEFAULT_TEXT_FRAME_ANCHOR,
      offset: options.offset ?? { x: 0, y: 0 },
    },
    width: options.width ?? DEFAULT_TEXT_FRAME_WIDTH,
    content: textContentFromPlain(options.text ?? "Text"),
  };
}

function withFrames(score: Score, scoreIndex: number, update: (frames: TextFrame[]) => TextFrame[] | null): Score {
  const current = score.scores?.[scoreIndex];
  if (!current) return score;
  const next = update([...(current.textFrames ?? [])]);
  if (!next) return score;
  return withScoreDef(score, scoreIndex, (sd) => {
    const updated: ScoreDefinition = { ...sd, textFrames: next };
    if (next.length === 0) delete updated.textFrames;
    return updated;
  });
}

/** Append a frame on top of the existing frames. Returns the input when the ID is already used. */
export function addTextFrameInScore(score: Score, scoreIndex: number, frame: TextFrame): Score {
  const taken = (score.scores ?? []).some((sd) => sd.textFrames?.some((existing) => existing.id === frame.id));
  if (taken) return score;
  return withFrames(score, scoreIndex, (frames) => [...frames, frame]);
}

/** Replace one frame by ID with `update(frame)`; the ID itself is immutable. */
export function updateTextFrameInScore(
  score: Score,
  scoreIndex: number,
  frameId: string,
  update: (frame: TextFrame) => TextFrame,
): Score {
  return withFrames(score, scoreIndex, (frames) => {
    const index = frames.findIndex((frame) => frame.id === frameId);
    if (index < 0) return null;
    frames[index] = { ...update(frames[index]!), id: frameId };
    return frames;
  });
}

export function setTextFrameContentInScore(
  score: Score,
  scoreIndex: number,
  frameId: string,
  content: TextContent,
): Score {
  return updateTextFrameInScore(score, scoreIndex, frameId, (frame) => ({ ...frame, content }));
}

/** Move by a delta in staff spaces relative to the frame's page anchor. */
export function moveTextFrameInScore(
  score: Score,
  scoreIndex: number,
  frameId: string,
  delta: { x: number; y: number },
): Score {
  if (delta.x === 0 && delta.y === 0) return score;
  return updateTextFrameInScore(score, scoreIndex, frameId, (frame) => ({
    ...frame,
    placement: {
      ...frame.placement,
      offset: { x: frame.placement.offset.x + delta.x, y: frame.placement.offset.y + delta.y },
    },
  }));
}

/**
 * Resize the frame width. Values are clamped to the unit's valid range
 * (positive staff spaces; a text-column fraction in (0, 1]). Height is always
 * automatic in the frame model, so there is no height to resize.
 */
export function resizeTextFrameInScore(
  score: Score,
  scoreIndex: number,
  frameId: string,
  width: TextFrameWidth,
): Score {
  const clamped = clampTextFrameWidth(width);
  return updateTextFrameInScore(score, scoreIndex, frameId, (frame) => ({ ...frame, width: clamped }));
}

const MIN_STAFF_SPACE_WIDTH = 1;
const MIN_COLUMN_FRACTION = 0.05;

function clampTextFrameWidth(width: TextFrameWidth): TextFrameWidth {
  if (width.unit === "staffSpaces") {
    return { unit: "staffSpaces", value: Math.max(MIN_STAFF_SPACE_WIDTH, width.value) };
  }
  return { unit: "textColumnFraction", value: Math.min(1, Math.max(MIN_COLUMN_FRACTION, width.value)) };
}

export function deleteTextFrameInScore(score: Score, scoreIndex: number, frameId: string): Score {
  return withFrames(score, scoreIndex, (frames) => {
    const remaining = frames.filter((frame) => frame.id !== frameId);
    return remaining.length === frames.length ? null : remaining;
  });
}

/** Reorder a frame's paint layer. No-op when already at the requested edge. */
export function reorderTextFrameInScore(
  score: Score,
  scoreIndex: number,
  frameId: string,
  command: TextFrameLayerCommand,
): Score {
  return withFrames(score, scoreIndex, (frames) => {
    const index = frames.findIndex((frame) => frame.id === frameId);
    if (index < 0) return null;
    const last = frames.length - 1;
    const target = { forward: Math.min(last, index + 1), backward: Math.max(0, index - 1), front: last, back: 0 }[
      command
    ];
    if (target === index) return null;
    const [frame] = frames.splice(index, 1);
    frames.splice(target, 0, frame!);
    return frames;
  });
}

// ─── Musical locator resolution ──────────────────────────────────────────

function containsEvent(content: readonly SequenceContent[], eventId: string): boolean {
  return content.some((item) => {
    if (item.type === "event") return item.id === eventId;
    if (item.type === "space") return false;
    return containsEvent(item.content, eventId);
  });
}

/**
 * Zero-based global measure index a musical locator follows, or null for page
 * locators and for targets that no longer exist in the score.
 */
export function textFrameLocatorMeasureIndex(score: Score, locator: TextFrameLocator): number | null {
  if (locator.type === "page") return null;
  if (locator.type === "globalMeasure") {
    const index = score.global.measures.findIndex((measure) => measure.id === locator.measureId);
    return index >= 0 ? index : null;
  }
  const part = score.parts.find((candidate) => candidate.id === locator.partId);
  if (!part) return null;
  const index = part.measures.findIndex((measure) =>
    measure.sequences.some((sequence) => containsEvent(sequence.content, locator.eventId)),
  );
  return index >= 0 ? index : null;
}

/**
 * Global-measure locator for a zero-based measure index. Null when the measure
 * has no authored ID: frames follow stable MNX IDs, never positional ones that
 * would silently retarget when measures are inserted.
 */
export function measureLocatorAt(score: Score, measureIndex: number): TextFrameLocator | null {
  const measureId = score.global.measures[measureIndex]?.id;
  return measureId ? { type: "globalMeasure", measureId } : null;
}

/**
 * Whether a musical locator targets music present in this score view. Page
 * locators always resolve here; whether the page exists is a pagination fact.
 * Unresolved frames stay authored but are not drawn, so the UI must surface them.
 */
export function textFrameLocatorResolvesInView(score: Score, scoreIndex: number, locator: TextFrameLocator): boolean {
  if (locator.type === "page") return true;
  if (textFrameLocatorMeasureIndex(score, locator) === null) return false;
  if (locator.type === "globalMeasure") return true;
  const layoutId = score.scores?.[scoreIndex]?.layout;
  return layoutId === undefined || scoreLayoutContainsPart(score, layoutId, locator.partId);
}

const TEXT_FRAME_ELEMENT_PREFIX = "text-frame/";

/**
 * Display-list element ID for a frame: the engine percent-encodes `%` then `/`,
 * so distinct frame IDs always yield distinct element IDs.
 */
export function textFrameElementId(frameId: string): string {
  return `${TEXT_FRAME_ELEMENT_PREFIX}${frameId.replaceAll("%", "%25").replaceAll("/", "%2F")}`;
}

/** Map a display-list element ID back to its authored frame ID, or `null` when no frame matches. */
export function textFrameIdFromElementId(elementId: string, frames: readonly TextFrame[]): string | null {
  if (!elementId.startsWith(TEXT_FRAME_ELEMENT_PREFIX)) return null;
  return frames.find((frame) => textFrameElementId(frame.id) === elementId)?.id ?? null;
}
