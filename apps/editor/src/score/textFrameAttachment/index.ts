import type {
  Score,
  SystemText,
  TextContent,
  TextExpression,
  TextFrame,
  TextFrameStaffAttachment,
} from "@viritura/core";
import { generateId } from "@viritura/core";
import { produce } from "../scoreClone";
import { ensureMeasureId } from "../spanUtils";
import { buildTextFrame, nextTextFrameId } from "../textFrameMutations";
import { expressionId, systemTextId } from "../ElementPath";

export class TextAttachmentError extends Error {}

export interface StaffTextDestination {
  partIndex: number;
  measureIndex: number;
  expression: TextFrameStaffAttachment["expression"];
}

function validDestination(score: Score, destination: StaffTextDestination): void {
  const part = score.parts[destination.partIndex];
  const staff = destination.expression.staff ?? 1;
  if (!score.global.measures[destination.measureIndex] || !part?.measures[destination.measureIndex]) {
    throw new TextAttachmentError("The destination measure or part no longer exists. Select another destination.");
  }
  if (staff > (part.staves ?? 1)) {
    throw new TextAttachmentError("The original staff no longer exists. Select another destination.");
  }
}

function originalStaffDestination(score: Score, frame: TextFrame): StaffTextDestination | null {
  const saved = frame.staffAttachment;
  if (!saved) return null;
  const partIndex = score.parts.findIndex((part) => part.id === saved.partId);
  const measureIndex = score.global.measures.findIndex((measure) => measure.id === saved.measureId);
  if (partIndex < 0 || measureIndex < 0) return null;
  const part = score.parts[partIndex]!;
  if (!part.measures[measureIndex] || (saved.expression.staff ?? 1) > (part.staves ?? 1)) return null;
  return { partIndex, measureIndex, expression: saved.expression };
}

function ensurePartId(score: Score, partIndex: number): string {
  const part = score.parts[partIndex]!;
  if (part.id) return part.id;
  const ids = new Set(score.parts.map((candidate) => candidate.id));
  let number = partIndex + 1;
  while (ids.has(`text-part-${number}`)) number++;
  part.id = `text-part-${number}`;
  return part.id;
}

function explicitSlant(content: TextContent, italic: boolean): TextContent {
  return content.map((chunk) =>
    "text" in chunk && chunk.style?.fontStyle === undefined
      ? { ...chunk, style: { ...chunk.style, fontStyle: italic ? "italic" : "normal" } }
      : chunk,
  );
}

/** One atomic move: staff text is removed globally; the page frame belongs to the active view. */
export function staffTextToPage(
  score: Score,
  scoreIndex: number,
  partIndex: number,
  measureIndex: number,
  expressionIndex: number,
): { score: Score; frameId: string } {
  const implicitFullScore = scoreIndex === 0 && !score.scores?.length;
  if (!implicitFullScore && !score.scores?.[scoreIndex]) {
    throw new TextAttachmentError("Select a score view before changing positioning.");
  }
  const expression = score.parts[partIndex]?.measures[measureIndex]?.expressions?.[expressionIndex];
  if (!expression) throw new TextAttachmentError("The selected staff text no longer exists.");
  validDestination(score, { partIndex, measureIndex, expression });
  const taken = new Set((score.scores ?? []).flatMap((view) => (view.textFrames ?? []).map((frame) => frame.id)));
  const frameId =
    expression.pagePosition && !taken.has(expression.pagePosition.id)
      ? expression.pagePosition.id
      : nextTextFrameId(score);
  const next = produce(score, (draft) => {
    if (implicitFullScore) draft.scores = [{ name: "Full score" }];
    const measureId = ensureMeasureId(draft, measureIndex);
    const partId = ensurePartId(draft, partIndex);
    const { text, frame: presentation, pagePosition, ...staffSettings } = expression;
    const { width, ...shared } = presentation ?? {};
    const geometry =
      pagePosition ??
      buildTextFrame(draft, {
        id: frameId,
        locator: { type: "globalMeasure", measureId },
        width,
      });
    const pageFrame: TextFrame = {
      id: frameId,
      locator: geometry.locator,
      placement: geometry.placement,
      width: geometry.width,
      ...(geometry.sourceReference ? { sourceReference: geometry.sourceReference } : {}),
      ...shared,
      content: explicitSlant(text, expression.placement !== "above"),
      staffAttachment: { partId, measureId, expression: staffSettings, ...(width ? { width } : {}) },
    };
    const view = draft.scores![scoreIndex]!;
    const frames = (view.textFrames ??= []);
    frames.splice(Math.min(pagePosition?.layer ?? frames.length, frames.length), 0, pageFrame);
    const expressions = draft.parts[partIndex]!.measures[measureIndex]!.expressions!;
    expressions.splice(expressionIndex, 1);
    if (!expressions.length) delete draft.parts[partIndex]!.measures[measureIndex]!.expressions;
  });
  return { score: next, frameId };
}

/** Restores stable musical identity when possible; never silently retargets a missing original. */
export function pageTextToStaff(
  score: Score,
  scoreIndex: number,
  frameId: string,
  fallback?: StaffTextDestination,
): { score: Score; elementId: string } {
  const frame = score.scores?.[scoreIndex]?.textFrames?.find((candidate) => candidate.id === frameId);
  if (!frame) throw new TextAttachmentError("The selected page frame no longer exists.");
  const original = originalStaffDestination(score, frame);
  const destination = original ?? fallback;
  if (!destination)
    throw new TextAttachmentError("Select a staff and measure in the score, then select this frame again.");
  validDestination(score, destination);
  const { partIndex, measureIndex } = destination;
  const expressionIndex = score.parts[partIndex]!.measures[measureIndex]!.expressions?.length ?? 0;
  const next = produce(score, (draft) => {
    const {
      width: pageWidth,
      content,
      id,
      locator,
      placement,
      sourceReference,
      staffAttachment: _attachment,
      ...shared
    } = frame;
    const width = frame.staffAttachment?.width;
    const expression: TextExpression = {
      ...destination.expression,
      text: explicitSlant(content, false),
      frame: { ...shared, ...(width ? { width } : {}) },
      pagePosition: {
        id,
        locator,
        placement,
        width: pageWidth,
        layer: score.scores![scoreIndex]!.textFrames!.findIndex((candidate) => candidate.id === frameId),
        ...(sourceReference ? { sourceReference } : {}),
      },
    };
    (draft.parts[partIndex]!.measures[measureIndex]!.expressions ??= []).push(expression);
    const view = draft.scores![scoreIndex]!;
    view.textFrames = view.textFrames!.filter((candidate) => candidate.id !== frameId);
    if (!view.textFrames.length) delete view.textFrames;
  });
  return { score: next, elementId: expressionId(partIndex, measureIndex, expressionIndex) };
}

/** Atomically changes a staff expression to one globally owned system instruction. */
export function staffTextToSystem(
  score: Score,
  partIndex: number,
  measureIndex: number,
  expressionIndex: number,
): { score: Score; elementId: string } {
  const expression = score.parts[partIndex]?.measures[measureIndex]?.expressions?.[expressionIndex];
  if (!expression) throw new TextAttachmentError("The selected staff text no longer exists.");
  if (!score.global.measures[measureIndex]) {
    throw new TextAttachmentError("The text's global measure no longer exists.");
  }
  const existingIds = new Set(score.global.measures[measureIndex]?.systemText?.map((text) => text.id));
  let id = generateId();
  while (existingIds.has(id)) id = generateId();
  const systemText: SystemText = {
    id,
    text: expression.text,
    position: expression.position,
    ...(expression.placement === undefined ? {} : { placement: expression.placement }),
    ...(expression.manualOffset === undefined ? {} : { manualOffset: expression.manualOffset }),
    ...(expression.avoidCollisions === undefined ? {} : { avoidCollisions: expression.avoidCollisions }),
    ...(expression.frame === undefined ? {} : { frame: expression.frame }),
  };
  const next = produce(score, (draft) => {
    const globalMeasure = draft.global.measures[measureIndex]!;
    (globalMeasure.systemText ??= []).push(systemText);
    const expressions = draft.parts[partIndex]!.measures[measureIndex]!.expressions!;
    expressions.splice(expressionIndex, 1);
    if (expressions.length === 0) delete draft.parts[partIndex]!.measures[measureIndex]!.expressions;
  });
  return { score: next, elementId: systemTextId(measureIndex, id) };
}

/** Atomically changes shared system text into staff text at an explicit destination. */
export function systemTextToStaff(
  score: Score,
  partIndex: number,
  measureIndex: number,
  id: string,
  staff = 1,
): { score: Score; elementId: string } {
  const part = score.parts[partIndex];
  const measure = part?.measures[measureIndex];
  const globalMeasure = score.global.measures[measureIndex];
  const systemText = globalMeasure?.systemText?.find((text) => text.id === id);
  if (!part || !measure || !globalMeasure || !systemText) {
    throw new TextAttachmentError("The selected system text or destination measure no longer exists.");
  }
  if (!Number.isInteger(staff) || staff < 1 || staff > (part.staves ?? 1)) {
    throw new TextAttachmentError("Select a staff that exists in the destination part.");
  }
  const expressionIndex = measure.expressions?.length ?? 0;
  const expression: TextExpression = {
    text: systemText.text,
    position: systemText.position,
    ...(systemText.placement === undefined ? {} : { placement: systemText.placement }),
    ...(staff === 1 ? {} : { staff }),
    ...(systemText.manualOffset === undefined ? {} : { manualOffset: systemText.manualOffset }),
    ...(systemText.avoidCollisions === undefined ? {} : { avoidCollisions: systemText.avoidCollisions }),
    ...(systemText.frame === undefined ? {} : { frame: systemText.frame }),
  };
  const next = produce(score, (draft) => {
    const texts = draft.global.measures[measureIndex]!.systemText!;
    const index = texts.findIndex((text) => text.id === id);
    if (index < 0) throw new TextAttachmentError("The selected system text no longer exists.");
    texts.splice(index, 1);
    if (texts.length === 0) delete draft.global.measures[measureIndex]!.systemText;
    (draft.parts[partIndex]!.measures[measureIndex]!.expressions ??= []).push(expression);
  });
  return { score: next, elementId: expressionId(partIndex, measureIndex, expressionIndex) };
}
