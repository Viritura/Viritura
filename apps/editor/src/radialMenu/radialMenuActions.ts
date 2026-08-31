/**
 * Radial menu actions — helpers that bridge radial menu selections
 * to score mutations.
 */

import type { DynamicGroup, Score, RhythmicPosition, TextExpression } from "@viritura/core";
import { createDynamicGroup, createRelativeDynamicGroup, generateId } from "@viritura/core";
import { getEventAtLocation, resolveEventLocation } from "../score/ElementPath";
import { ensureMeasureId } from "../score/spanUtils";
import { sequenceContentBeats } from "../commands/noteCommands";
import { getActiveTimeSignature } from "../commands/cursorCommands";
import { dynamicStaffAtLocation } from "../commands/dynamicStaff";
import { resolveCondensedSelectionEvents } from "../score/condensedWriteback";
import { resolveSelectionEvents } from "../store/selectionUtils";
import type { Selection } from "../store/selectionStore";
import {
  setOrnaments,
  setTrillAccidental,
  setFermataShape,
  setBreathMark,
  setCaesura,
} from "../commands/articulationCommands";
import type { OrnamentSelection } from "./ornamentMenu";
import type { BreathFermataSelection } from "./breathFermataMenu";
import type { ExpressionToken, MixedExpressionToken } from "./dynamicExpressionParser";

// ═══════════════════════════════════════════
// Position helpers
// ═══════════════════════════════════════════

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function fractionValue(position: RhythmicPosition): number {
  const [numerator, denominator] = position.fraction;
  return denominator === 0 ? 0 : numerator / denominator;
}

function rhythmicPosition(value: number): RhythmicPosition {
  const denominator = 65536;
  const numerator = Math.round(value * denominator);
  const divisor = gcd(numerator, denominator);
  return { fraction: [numerator / divisor, denominator / divisor] };
}

function measureDurationPosition(score: Score, measureIndex: number): RhythmicPosition {
  const time = getActiveTimeSignature(score, measureIndex);
  const divisor = gcd(time.count, time.unit);
  return { fraction: [time.count / divisor, time.unit / divisor] };
}

function relativeValueForQualifier(prefix: string | undefined, spelling: string): "louder" | "softer" | undefined {
  const qualifier = prefix?.trim().toLocaleLowerCase();
  let writtenDirection: "louder" | "softer" | undefined;
  if (/^(?:ppp|pp|p|mp)$/.test(spelling)) writtenDirection = "softer";
  if (/^(?:mf|f|ff|fff)$/.test(spelling)) writtenDirection = "louder";
  if (!writtenDirection) return undefined;
  if (qualifier === "più" || qualifier === "piu") return writtenDirection;
  if (qualifier === "meno") return writtenDirection === "louder" ? "softer" : "louder";
  return undefined;
}

/** Compute the rhythmic position (fraction of a whole note) of an event. */
function computeEventPosition(
  score: Score,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
  eventIndex: number,
): RhythmicPosition {
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  if (!seq) return { fraction: [0, 1] };
  let beatSum = 0;
  for (let i = 0; i < eventIndex && i < seq.content.length; i++) {
    beatSum += sequenceContentBeats(seq.content[i]!);
  }
  const num = Math.round(beatSum * 256);
  const den = 1024;
  const g = gcd(num, den);
  return { fraction: [num / g, den / g] };
}

/** Compute the rhythmic position at the END of an event (start + duration). */
function computeEventEndPosition(
  score: Score,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
  eventIndex: number,
): RhythmicPosition {
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  if (!seq) return { fraction: [1, 1] };
  let beatSum = 0;
  for (let i = 0; i <= eventIndex && i < seq.content.length; i++) {
    beatSum += sequenceContentBeats(seq.content[i]!);
  }
  const num = Math.round(beatSum * 256);
  const den = 1024;
  const g = gcd(num, den);
  return { fraction: [num / g, den / g] };
}

// ═══════════════════════════════════════════
// Resolve selection → per-part targets
// ═══════════════════════════════════════════

/** Information for one part's dynamic placement. */
interface DynamicTarget {
  partIndex: number;
  staff?: number;
  startMeasureIndex: number;
  startPosition: RhythmicPosition;
  /** End info — only set for range/measure selections. */
  endMeasureIndex?: number;
  endPosition?: RhythmicPosition;
}

interface DynamicBoundary {
  measureIndex: number;
  position: RhythmicPosition;
}

function resolveMultiTargets(score: Score, selection: Extract<Selection, { kind: "multi" }>): DynamicTarget[] {
  const byPart = new Map<number, NonNullable<ReturnType<typeof resolveEventLocation>>[]>();
  for (const elementId of selection.elementIds) {
    const location = resolveEventLocation(elementId, score);
    if (!location) continue;
    const locations = byPart.get(location.partIndex) ?? [];
    locations.push(location);
    byPart.set(location.partIndex, locations);
  }
  return [...byPart.values()].flatMap((locations) => {
    locations.sort(
      (left, right) =>
        left.measureIndex - right.measureIndex ||
        left.sequenceIndex - right.sequenceIndex ||
        left.eventIndex - right.eventIndex,
    );
    const first = locations[0];
    const last = locations.at(-1);
    if (!first || !last) return [];
    return [
      {
        partIndex: first.partIndex,
        staff: dynamicStaffAtLocation(score, first),
        startMeasureIndex: first.measureIndex,
        startPosition: computeEventPosition(
          score,
          first.partIndex,
          first.measureIndex,
          first.sequenceIndex,
          first.eventIndex,
        ),
        endMeasureIndex: last.measureIndex,
        endPosition: computeEventEndPosition(
          score,
          last.partIndex,
          last.measureIndex,
          last.sequenceIndex,
          last.eventIndex,
        ),
      },
    ];
  });
}

function canonicalBoundary(score: Score, measureIndex: number, position: RhythmicPosition): DynamicBoundary {
  const atMeasureEnd =
    Math.abs(fractionValue(position) - fractionValue(measureDurationPosition(score, measureIndex))) < Number.EPSILON;
  return atMeasureEnd && measureIndex + 1 < score.global.measures.length
    ? { measureIndex: measureIndex + 1, position: { fraction: [0, 1] } }
    : { measureIndex, position };
}

function hairpinEndBoundary(score: Score, start: DynamicBoundary, end: DynamicBoundary): DynamicBoundary {
  if (end.measureIndex <= start.measureIndex || Math.abs(fractionValue(end.position)) >= Number.EPSILON) return end;
  const previousMeasureIndex = end.measureIndex - 1;
  return {
    measureIndex: previousMeasureIndex,
    position: measureDurationPosition(score, previousMeasureIndex),
  };
}

/** Divide a selected rhythmic span into equal, sequential hairpin segments. */
function expressionBoundaries(score: Score, target: DynamicTarget, segmentCount: number): DynamicBoundary[] {
  const endMeasureIndex = target.endMeasureIndex ?? target.startMeasureIndex;
  const endPosition = target.endPosition ?? measureDurationPosition(score, endMeasureIndex);
  if (segmentCount === 0) {
    return [{ measureIndex: target.startMeasureIndex, position: target.startPosition }];
  }

  const measureDurations: number[] = [];
  for (let measureIndex = target.startMeasureIndex; measureIndex <= endMeasureIndex; measureIndex++) {
    measureDurations.push(fractionValue(measureDurationPosition(score, measureIndex)));
  }
  const starts: number[] = [0];
  for (const duration of measureDurations) starts.push(starts[starts.length - 1]! + duration);

  const absoluteStart = fractionValue(target.startPosition);
  const absoluteEnd = starts[endMeasureIndex - target.startMeasureIndex]! + fractionValue(endPosition);
  const span = Math.max(0, absoluteEnd - absoluteStart);
  const canonicalEnd = canonicalBoundary(score, endMeasureIndex, endPosition);

  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    if (index === 0) return { measureIndex: target.startMeasureIndex, position: target.startPosition };
    if (index === segmentCount) return canonicalEnd;

    const absolute = absoluteStart + (span * index) / segmentCount;
    for (let offset = 0; offset < measureDurations.length; offset++) {
      const measureEnd = starts[offset + 1]!;
      if (absolute < measureEnd - Number.EPSILON || offset === measureDurations.length - 1) {
        return {
          measureIndex: target.startMeasureIndex + offset,
          position: rhythmicPosition(absolute - starts[offset]!),
        };
      }
    }
    return { measureIndex: endMeasureIndex, position: endPosition };
  });
}

/**
 * Resolve the selection into one or more DynamicTargets (one per affected part/staff).
 * Mutates score to add measure IDs where needed — caller should pass a clone.
 */
function resolveTargets(score: Score, selection: Selection): DynamicTarget[] {
  if (selection.kind === "none") return [];

  if (selection.kind === "single") {
    const loc = resolveEventLocation(selection.elementId, score);
    if (!loc) return [];
    return [
      {
        partIndex: loc.partIndex,
        staff: dynamicStaffAtLocation(score, loc),
        startMeasureIndex: loc.measureIndex,
        startPosition: computeEventPosition(score, loc.partIndex, loc.measureIndex, loc.sequenceIndex, loc.eventIndex),
      },
    ];
  }

  if (selection.kind === "range") {
    const startLoc = resolveEventLocation(selection.startElementId, score);
    const endLoc = resolveEventLocation(selection.endElementId, score);
    if (!startLoc || !endLoc) return [];

    // Normalize start/end ordering
    const [first, last] =
      startLoc.measureIndex < endLoc.measureIndex
        ? [startLoc, endLoc]
        : startLoc.measureIndex > endLoc.measureIndex
          ? [endLoc, startLoc]
          : startLoc.eventIndex <= endLoc.eventIndex
            ? [startLoc, endLoc]
            : [endLoc, startLoc];

    const startPos = computeEventPosition(
      score,
      first.partIndex,
      first.measureIndex,
      first.sequenceIndex,
      first.eventIndex,
    );
    const endPos = computeEventEndPosition(
      score,
      last.partIndex,
      last.measureIndex,
      last.sequenceIndex,
      last.eventIndex,
    );

    // If cross-part range, apply to each part
    const minPart = Math.min(first.partIndex, last.partIndex);
    const maxPart = Math.max(first.partIndex, last.partIndex);
    const targets: DynamicTarget[] = [];
    for (let p = minPart; p <= maxPart; p++) {
      targets.push({
        partIndex: p,
        ...(p === first.partIndex ? { staff: dynamicStaffAtLocation(score, first) } : {}),
        startMeasureIndex: first.measureIndex,
        startPosition: startPos,
        endMeasureIndex: last.measureIndex,
        endPosition: endPos,
      });
    }
    return targets;
  }

  if (selection.kind === "multi") {
    return resolveMultiTargets(score, selection);
  }

  if (selection.kind === "measure") {
    const startPart = Math.min(selection.startPartIndex, selection.endPartIndex);
    const endPart = Math.max(selection.startPartIndex, selection.endPartIndex);
    const startMeasure = Math.min(selection.startMeasure, selection.endMeasure);
    const endMeasure = Math.max(selection.startMeasure, selection.endMeasure);
    const targets: DynamicTarget[] = [];
    // Dynamics live at the part/measure level, so a multi-staff bar selection
    // places the marking on every selected part at once.
    for (let p = startPart; p <= endPart; p++) {
      const part = score.parts[p];
      const selectedStaff =
        startPart === endPart && (part?.staves ?? 1) > 1
          ? Math.min(selection.startStaffIndex, selection.endStaffIndex) + 1
          : undefined;
      targets.push({
        partIndex: p,
        ...(selectedStaff === undefined ? {} : { staff: selectedStaff }),
        startMeasureIndex: startMeasure,
        startPosition: { fraction: [0, 1] },
        endMeasureIndex: endMeasure,
        endPosition: measureDurationPosition(score, endMeasure),
      });
    }
    return targets;
  }

  return [];
}

function resolveDynamicTargets(score: Score, selection: Selection, selectedScoreIndex?: number): DynamicTarget[] {
  const targets = resolveTargets(score, selection);
  if (selectedScoreIndex === undefined) return targets;
  const sourceEvents = resolveCondensedSelectionEvents(score, selection, selectedScoreIndex);
  const sourceParts = new Set(sourceEvents.map((location) => location.partIndex));
  const expanded = targets.flatMap((target) => [...sourceParts].map((partIndex) => ({ ...target, partIndex })));
  return [...new Map(expanded.map((target) => [`${target.partIndex}/${target.staff ?? ""}`, target])).values()];
}

function resolveImmediateDynamicTargets(
  score: Score,
  selection: Selection,
  selectedScoreIndex?: number,
): DynamicTarget[] {
  const events =
    selectedScoreIndex === undefined
      ? resolveSelectionEvents(selection, score)
      : resolveCondensedSelectionEvents(score, selection, selectedScoreIndex);
  const targets = events
    .filter((location) => {
      const event = getEventAtLocation(score, location);
      return event?.type === "event" && (!!event.notes?.length || !!event.kitNotes?.length);
    })
    .map((location) => ({
      partIndex: location.partIndex,
      staff: dynamicStaffAtLocation(score, location),
      startMeasureIndex: location.measureIndex,
      startPosition: computeEventPosition(
        score,
        location.partIndex,
        location.measureIndex,
        location.sequenceIndex,
        location.eventIndex,
      ),
    }));
  return [
    ...new Map(
      targets.map((target) => [
        `${target.partIndex}/${target.staff ?? ""}/${target.startMeasureIndex}/${target.startPosition.fraction.join("/")}`,
        target,
      ]),
    ).values(),
  ];
}

// ═══════════════════════════════════════════
// Add a single dynamic marking
// ═══════════════════════════════════════════

/**
 * Add a dynamic marking at the start of the selection.
 * Supports single, range, multi, and measure selections.
 * For multi-part selections, the dynamic is added to each part.
 */
export function addDynamic(
  score: Score,
  selection: Selection,
  dynamicValue: string,
  selectedScoreIndex?: number,
): Score | null {
  const newScore = structuredClone(score);
  const targets = resolveImmediateDynamicTargets(newScore, selection, selectedScoreIndex);
  if (targets.length === 0) return null;

  for (const target of targets) {
    const pm = newScore.parts[target.partIndex]?.measures[target.startMeasureIndex];
    if (!pm) continue;
    const existing = pm.dynamics ?? [];
    const dyn = createDynamicGroup(dynamicValue, target.startPosition);
    if (target.staff !== undefined) dyn.staff = target.staff;
    pm.dynamics = [...existing, dyn];
  }

  return newScore;
}

// ═══════════════════════════════════════════
// Add a compound dynamic expression
// ═══════════════════════════════════════════

/**
 * Apply a compound dynamic expression (e.g. p<f, mf>pp, fp<ff>p).
 *
 * - Every dynamic token creates a visible immediate/accent group
 * - Hairpin tokens divide the selection into consecutive, equal-duration spans
 * - Dynamic tokens after a hairpin are placed at the corresponding segment boundary
 *
 * For single-event selections, hairpins span from the event to end of measure.
 * For range/measure selections, hairpins span the full range.
 * For multi-part selections, applied to each staff independently.
 */
export function addDynamicExpression(
  score: Score,
  selection: Selection,
  tokens: ExpressionToken[],
  selectedScoreIndex?: number,
): Score | null {
  if (tokens.length === 1 && tokens[0]?.type === "dynamic") {
    return addDynamic(score, selection, tokens[0].value, selectedScoreIndex);
  }
  const newScore = structuredClone(score);
  const targets = resolveDynamicTargets(newScore, selection, selectedScoreIndex);
  if (targets.length === 0) return null;

  const hairpinCount = tokens.filter((token) => token.type === "crescendo" || token.type === "diminuendo").length;

  for (const target of targets) {
    const boundaries = expressionBoundaries(newScore, target, hairpinCount);
    let boundaryIndex = 0;
    let previousGroupId: string | undefined;

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex]!;
      const boundary = boundaries[boundaryIndex]!;
      if (token.type === "dynamic") {
        const group = createDynamicGroup(token.value, boundary.position);
        if (target.staff !== undefined) group.staff = target.staff;
        const targetPm = newScore.parts[target.partIndex]?.measures[boundary.measureIndex];
        if (!targetPm) continue;
        const existing = targetPm.dynamics ?? [];
        group.visuallyContinues = previousGroupId;
        targetPm.dynamics = [...existing, group];
        previousGroupId = group.id;
      } else {
        const endBoundary = boundaries[boundaryIndex + 1]!;
        const hairpinEnd = hairpinEndBoundary(newScore, boundary, endBoundary);
        const targetPm = newScore.parts[target.partIndex]?.measures[boundary.measureIndex];
        if (!targetPm) continue;
        const existing = targetPm.dynamics ?? [];
        const hairpin: DynamicGroup = {
          id: generateId(),
          type: "gradual" as const,
          position: boundary.position,
          end: {
            measure: ensureMeasureId(newScore, hairpinEnd.measureIndex),
            position: hairpinEnd.position,
          },
          wedgeType: token.type === "crescendo" ? ("increasing" as const) : ("decreasing" as const),
          staff: target.staff,
        };
        hairpin.visuallyContinues = previousGroupId;
        targetPm.dynamics = [...existing, hairpin];
        previousGroupId = hairpin.id;
        boundaryIndex++;
      }
    }
  }

  return newScore;
}

// ═══════════════════════════════════════════
// Add a mixed expression (dynamics + text)
// ═══════════════════════════════════════════

interface TextualGradual {
  start: string;
  text: "cresc." | "dim.";
  end?: string;
}

function parseTextualGradual(tokens: readonly MixedExpressionToken[]): TextualGradual | undefined {
  if (
    (tokens.length !== 2 && tokens.length !== 3) ||
    tokens[0]?.type !== "dynamic" ||
    tokens[1]?.type !== "text" ||
    (tokens.length === 3 && tokens[2]?.type !== "dynamic")
  ) {
    return undefined;
  }
  const end = tokens[2]?.type === "dynamic" ? tokens[2].value : undefined;
  if (/^cresc(?:endo)?\.?$/i.test(tokens[1].value)) {
    return { start: tokens[0].value, text: "cresc.", ...(end ? { end } : {}) };
  }
  if (/^(?:dim(?:inuendo)?|decresc(?:endo)?)\.?$/i.test(tokens[1].value)) {
    return { start: tokens[0].value, text: "dim.", ...(end ? { end } : {}) };
  }
  return undefined;
}

function addTextualGradual(score: Score, target: DynamicTarget, gradual: TextualGradual): boolean {
  const [startBoundary, endBoundary] = expressionBoundaries(score, target, 1);
  if (!startBoundary || !endBoundary) return false;
  const startMeasure = score.parts[target.partIndex]?.measures[startBoundary.measureIndex];
  const endMeasure = score.parts[target.partIndex]?.measures[endBoundary.measureIndex];
  if (!startMeasure || !endMeasure) return false;

  const startGroup = createDynamicGroup(gradual.start, startBoundary.position);
  const endGroup = gradual.end ? createDynamicGroup(gradual.end, endBoundary.position) : undefined;
  if (target.staff !== undefined) {
    startGroup.staff = target.staff;
    if (endGroup) endGroup.staff = target.staff;
  }
  startMeasure.dynamics = [...(startMeasure.dynamics ?? []), startGroup];
  startMeasure.expressions = [
    ...(startMeasure.expressions ?? []),
    {
      text: gradual.text,
      position: startBoundary.position,
      ...(target.staff === undefined ? {} : { staff: target.staff }),
    },
  ];
  if (endGroup) endMeasure.dynamics = [...(endMeasure.dynamics ?? []), endGroup];
  return true;
}

/**
 * Apply a mixed expression like "p lovingly" or "mf dolce".
 * Dynamic tokens → dynamics annotations, text tokens → text expressions.
 */
export function addMixedExpression(
  score: Score,
  selection: Selection,
  tokens: MixedExpressionToken[],
  selectedScoreIndex?: number,
): Score | null {
  const newScore = structuredClone(score);
  const targets = resolveDynamicTargets(newScore, selection, selectedScoreIndex);
  if (targets.length === 0) return null;

  const gradualText = parseTextualGradual(tokens);

  for (const target of targets) {
    if (gradualText) {
      addTextualGradual(newScore, target, gradualText);
      continue;
    }

    const pm = newScore.parts[target.partIndex]?.measures[target.startMeasureIndex];
    if (!pm) continue;

    let lastDynamicIndex: number | undefined;
    let pendingPrefix: string | undefined;
    for (const token of tokens) {
      if (token.type === "dynamic") {
        const existing = pm.dynamics ?? [];
        const relativeDirection = relativeValueForQualifier(pendingPrefix, token.value);
        const group = relativeDirection
          ? createRelativeDynamicGroup(token.value, relativeDirection, target.startPosition, pendingPrefix)
          : createDynamicGroup(token.value, target.startPosition);
        if (pendingPrefix && group.type !== "relative") group.prefix = pendingPrefix;
        pm.dynamics = [...existing, group];
        lastDynamicIndex = pm.dynamics.length - 1;
        pendingPrefix = undefined;
      } else if (token.type === "text") {
        const dynamic = lastDynamicIndex === undefined ? undefined : pm.dynamics?.[lastDynamicIndex];
        if (dynamic) {
          dynamic.suffix = dynamic.suffix ? `${dynamic.suffix} ${token.value}` : token.value;
        } else if (tokens.some((item) => item.type === "dynamic")) {
          pendingPrefix = pendingPrefix ? `${pendingPrefix} ${token.value}` : token.value;
        } else {
          const existing = pm.expressions ?? [];
          const expr: TextExpression = { text: token.value, position: target.startPosition };
          pm.expressions = [...existing, expr];
        }
      }
    }
  }

  return newScore;
}

/**
 * Apply an ornament/trill/fermata to every event in the selection.
 * Mirrors the palette behavior: single / multi / range / measure are all
 * supported, applied to each selected event (tuplet-aware). Returns the new
 * score, or null if no events resolved.
 */
export function applyOrnament(
  score: Score,
  selection: Selection,
  resolved: OrnamentSelection,
  selectedScoreIndex?: number,
): Score | null {
  const events =
    selectedScoreIndex === undefined
      ? resolveSelectionEvents(selection, score)
      : resolveCondensedSelectionEvents(score, selection, selectedScoreIndex);
  if (events.length === 0) return null;

  let result: Score | null = structuredClone(score);
  for (const { partIndex, measureIndex, sequenceIndex, eventIndex, tupletIndex } of events) {
    if (!result) break;
    switch (resolved.kind) {
      case "ornament":
        result = setOrnaments(
          result,
          partIndex,
          measureIndex,
          sequenceIndex,
          eventIndex,
          [resolved.ornament],
          tupletIndex,
        );
        break;
      case "trill":
        result = setTrillAccidental(
          result,
          partIndex,
          measureIndex,
          sequenceIndex,
          eventIndex,
          resolved.accidental ?? null,
          tupletIndex,
        );
        break;
      case "fermata":
        result = setFermataShape(
          result,
          partIndex,
          measureIndex,
          sequenceIndex,
          eventIndex,
          resolved.shape,
          tupletIndex,
        );
        break;
    }
  }
  return result;
}

/**
 * Apply a breath mark, fermata, or caesura from the radial menu to every
 * event in the selection (single / multi / range / measure, tuplet-aware).
 */
export function applyBreathFermata(
  score: Score,
  selection: Selection,
  resolved: BreathFermataSelection,
  selectedScoreIndex?: number,
): Score | null {
  const events =
    selectedScoreIndex === undefined
      ? resolveSelectionEvents(selection, score)
      : resolveCondensedSelectionEvents(score, selection, selectedScoreIndex);
  if (events.length === 0) return null;

  let result: Score | null = structuredClone(score);
  for (const { partIndex, measureIndex, sequenceIndex, eventIndex, tupletIndex } of events) {
    if (!result) break;
    switch (resolved.kind) {
      case "breath":
        result = setBreathMark(
          result,
          partIndex,
          measureIndex,
          sequenceIndex,
          eventIndex,
          resolved.symbol,
          tupletIndex,
        );
        break;
      case "fermata":
        result = setFermataShape(
          result,
          partIndex,
          measureIndex,
          sequenceIndex,
          eventIndex,
          resolved.shape,
          tupletIndex,
        );
        break;
      case "caesura":
        result = setCaesura(result, partIndex, measureIndex, sequenceIndex, eventIndex, "normal");
        break;
    }
  }
  return result;
}
