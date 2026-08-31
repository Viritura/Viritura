import type { DynamicGroup, DynamicValue, LayoutContent, PartMeasure, Score, SequenceContent } from "@viritura/core";

interface ExplicitState {
  value: DynamicValue;
  position: number;
  partIndex: number;
  measureIndex: number;
}

export interface ImpliedSectionDynamicAnchor {
  partIndex: number;
  measureIndex: number;
  value: DynamicValue;
  sourcePartIndex: number;
  sourceMeasureIndex: number;
  position: [number, number];
}

function collectGroups(content: readonly LayoutContent[], score: Score, groups: number[][]): void {
  for (const node of content) {
    if (node.type === "group") {
      collectGroups(node.content, score, groups);
      continue;
    }
    if (node.sources.length < 2) continue;
    const indices = node.sources
      .map((source) => score.parts.findIndex((part) => part.id === source.part))
      .filter((index) => index >= 0);
    if (indices.length > 1) groups.push([...new Set(indices)]);
  }
}

/** Stable source groups are derived from every multi-source layout staff, not the active view. */
function sectionGroups(score: Score): number[][] {
  const groups: number[][] = [];
  for (const layout of score.layouts ?? []) collectGroups(layout.content, score, groups);
  return [
    ...new Map(
      groups.map((group) => {
        const sorted = [...group].sort((a, b) => a - b);
        return [sorted.join(","), sorted] as const;
      }),
    ).values(),
  ];
}

const WHOLE_DURATIONS: Record<string, number> = {
  maxima: 8,
  longa: 4,
  breve: 2,
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  "16th": 1 / 16,
  "32nd": 1 / 32,
  "64th": 1 / 64,
  "128th": 1 / 128,
  "256th": 1 / 256,
  "512th": 1 / 512,
  "1024th": 1 / 1024,
};

function durationValue(duration: { base: string; dots?: number }): number {
  const base = WHOLE_DURATIONS[duration.base] ?? 0;
  let value = base;
  for (let dot = 0; dot < (duration.dots ?? 0); dot++) value += base / 2 ** (dot + 1);
  return value;
}

interface ContentInfo {
  signature: unknown[];
  active: boolean;
  onset?: number;
  duration: number;
}

function contentInfo(content: readonly SequenceContent[], scale = 1): ContentInfo {
  let cursor = 0;
  let active = false;
  let onset: number | undefined;
  const signature = content.map((item) => {
    if (item.type === "event") {
      const sounding = !!item.notes?.length || !!item.kitNotes?.length;
      if (sounding) {
        active = true;
        onset ??= cursor;
      }
      const duration = durationValue(item.duration) * scale;
      cursor += duration;
      return {
        duration: item.duration,
        sounding,
      };
    }
    if (item.type === "tuplet") {
      const inner = durationValue(item.inner.duration) * item.inner.multiple;
      const outer = durationValue(item.outer.duration) * item.outer.multiple;
      const nested = contentInfo(item.content, scale * (inner > 0 ? outer / inner : 1));
      if (nested.active) {
        active = true;
        onset ??= cursor + nested.onset!;
      }
      cursor += nested.duration;
      return { type: item.type, inner: item.inner, outer: item.outer, content: nested.signature };
    }
    if (item.type === "tremolo") {
      const duration = durationValue(item.outer.duration) * item.outer.multiple * scale;
      if (item.content.some((event) => !!event.notes?.length || !!event.kitNotes?.length)) {
        active = true;
        onset ??= cursor;
      }
      cursor += duration;
      return { type: item.type, outer: item.outer, content: item.content.map((event) => event.duration) };
    }
    if (item.type === "grace") return { type: item.type, content: item.content.map((event) => event.duration) };
    if (item.type === "space") {
      const duration = (item.duration[1] === 0 ? 0 : item.duration[0] / item.duration[1]) * scale;
      cursor += duration;
      return { type: item.type, duration: item.duration };
    }
    return {};
  });
  return { signature, active, onset, duration: cursor };
}

function measureActivity(measure: PartMeasure | undefined): { active: boolean; rhythm: string; onset: number } {
  if (!measure) return { active: false, rhythm: "", onset: 0 };
  let active = false;
  let onset: number | undefined;
  const signature = measure.sequences.map((sequence) => {
    const content = contentInfo(sequence.content);
    if (content.active) {
      active = true;
      onset = Math.min(onset ?? Number.POSITIVE_INFINITY, content.onset ?? 0);
    }
    return { staff: sequence.staff, voice: sequence.voice, content: content.signature };
  });
  return { active, rhythm: JSON.stringify(signature), onset: onset ?? 0 };
}

function persistentValue(group: DynamicGroup): DynamicValue | undefined {
  if (group.type === "immediate") return group.value;
  if (group.type === "accent") return group.residualValue;
  if (group.type === "gradual") return group.value;
  return undefined;
}

function positionValue(group: DynamicGroup): number {
  const [numerator, denominator] = group.position.fraction;
  return denominator === 0 ? 0 : numerator / denominator;
}

function positionFraction(value: number): [number, number] {
  const denominator = 65536;
  const numerator = Math.round(value * denominator);
  const gcd = (left: number, right: number): number => {
    while (right !== 0) [left, right] = [right, left % right];
    return Math.abs(left) || 1;
  };
  const divisor = gcd(numerator, denominator);
  return [numerator / divisor, denominator / divisor];
}

function explicitStates(measure: PartMeasure | undefined, partIndex: number, measureIndex: number): ExplicitState[] {
  return (measure?.dynamics ?? [])
    .flatMap((group) => {
      const value = persistentValue(group);
      return value ? [{ value, position: positionValue(group), partIndex, measureIndex }] : [];
    })
    .sort((left, right) => left.position - right.position);
}

function agreedExplicit(states: readonly ExplicitState[]): ExplicitState | null | undefined {
  if (states.length === 0) return undefined;
  const values = new Set(states.map((state) => state.value));
  return values.size === 1 ? states[0]! : null;
}

function updateShared(
  states: ReadonlyMap<number, readonly ExplicitState[]>,
  activeParts: readonly number[],
  positions: readonly number[],
  ownState: Map<number, DynamicValue>,
  initial: ExplicitState | undefined,
): ExplicitState | undefined {
  let shared = initial;
  for (const position of positions) {
    const activeAtPosition = activeParts.flatMap((partIndex) =>
      states.get(partIndex)!.filter((state) => state.position === position),
    );
    const agreement = agreedExplicit(activeAtPosition);
    if (agreement === null) shared = undefined;
    else if (agreement) shared = agreement;
    for (const partIndex of states.keys()) {
      // A dynamic written while this player rests still establishes that
      // player's own state; retain it so a later reentry never overwrites an
      // explicit instruction with a section inference.
      const own = states.get(partIndex)!.find((state) => state.position === position);
      if (own) ownState.set(partIndex, own.value);
    }
  }
  return shared;
}

function analyzeGroup(score: Score, group: readonly number[]): ImpliedSectionDynamicAnchor[] {
  const inferred: ImpliedSectionDynamicAnchor[] = [];
  const ownState = new Map<number, DynamicValue>();
  let shared: ExplicitState | undefined;

  for (let measureIndex = 0; measureIndex < score.global.measures.length; measureIndex++) {
    const activity = new Map(
      group.map((partIndex) => [partIndex, measureActivity(score.parts[partIndex]?.measures[measureIndex])]),
    );
    const activeParts = group.filter((partIndex) => activity.get(partIndex)?.active);
    const states = new Map(
      group.map((partIndex) => [
        partIndex,
        explicitStates(score.parts[partIndex]?.measures[measureIndex], partIndex, measureIndex),
      ]),
    );
    const merged =
      activeParts.length > 1 && new Set(activeParts.map((partIndex) => activity.get(partIndex)!.rhythm)).size === 1;
    const onset = merged ? Math.min(...activeParts.map((partIndex) => activity.get(partIndex)!.onset)) : 0;
    const positions = [
      ...new Set(group.flatMap((partIndex) => states.get(partIndex)!.map((state) => state.position))),
    ].sort((a, b) => a - b);
    shared = updateShared(
      states,
      activeParts,
      positions.filter((position) => !merged || position <= onset),
      ownState,
      shared,
    );
    if (merged && shared) {
      for (const partIndex of activeParts) {
        const hasExplicitAtOnset = states.get(partIndex)!.some((state) => state.position === onset);
        if (hasExplicitAtOnset || ownState.get(partIndex) === shared.value) continue;
        inferred.push({
          partIndex,
          measureIndex,
          value: shared.value,
          sourcePartIndex: shared.partIndex,
          sourceMeasureIndex: shared.measureIndex,
          position: positionFraction(onset),
        });
        ownState.set(partIndex, shared.value);
      }
    }

    shared = updateShared(
      states,
      activeParts,
      positions.filter((position) => merged && position > onset),
      ownState,
      shared,
    );
  }
  return inferred;
}

/** Compute playback-only implied anchors without creating notation objects. */
export function analyzeImpliedSectionDynamics(
  score: Score,
): ReadonlyMap<number, readonly ImpliedSectionDynamicAnchor[]> {
  const inferred = sectionGroups(score).flatMap((group) => analyzeGroup(score, group));
  const byPart = new Map<number, ImpliedSectionDynamicAnchor[]>();
  for (const anchor of inferred) {
    const anchors = byPart.get(anchor.partIndex) ?? [];
    anchors.push(anchor);
    byPart.set(anchor.partIndex, anchors);
  }
  return byPart;
}
