import type { HarpPedalTuning, Pitch, Score } from "../index";
import type { HarpPedalAlter, HarpPedalLetter } from "./index";
import { collectHarpPedalNotes, harpPedalFractionFromNumber, type HarpPedalNote } from "./pedalAnalysis";
import { isHarpInstrumentAt } from "./pedalState";
import {
  canonicalBeat,
  harpSearchTimeline,
  manualAnchors,
  measurePositions,
  type ManualAnchor,
} from "./calculationTimeline";
import { buildHarpTieChains } from "./tieChains";
import { searchHarpPedals, searchSolution } from "./pedalSearch";
import {
  comparePedalCost as compareTuningCost,
  compareSearchLabels,
  PEDAL_LETTERS as PEDALS,
} from "./searchTransitions";

export type HarpPedalSolutionKind = "no-respelling" | "suggest-respelling" | "maximum-respell";

export interface HarpPedalCalculatedSetting {
  measureIndex: number;
  fraction: [number, number];
  tuning: HarpPedalTuning;
}

export interface HarpPedalSpellingEdit {
  eventId: string;
  noteIndex: number;
  pitch: Pitch;
}

export interface HarpPedalSolution {
  kind: HarpPedalSolutionKind;
  settings: HarpPedalCalculatedSetting[];
  spellingEdits: HarpPedalSpellingEdit[];
  settingChanges: number;
  pedalMovements: number;
}

export interface HarpPedalCalculation {
  solutions: HarpPedalSolution[];
  error?: string;
}

interface CalculationState {
  settings: HarpPedalCalculatedSetting[];
  settingChanges: number;
  pedalMovements: number;
}

interface NoteGroup {
  beat: number;
  measureIndex: number;
  fraction: [number, number];
  notes: HarpPedalNote[];
}

interface CompatiblePrefix {
  boundary: number;
  constraints: Map<HarpPedalLetter, HarpPedalAlter>;
}

function sameTuning(left: HarpPedalTuning, right: HarpPedalTuning): boolean {
  return PEDALS.every((letter) => left[letter] === right[letter]);
}

function groupNotes(
  notes: readonly HarpPedalNote[],
  durations: readonly number[],
  offsets: readonly number[],
): NoteGroup[] {
  const groups = new Map<number, NoteGroup>();
  for (const note of notes) {
    const beat = note.beat;
    const measureIndex = note.measureIndex;
    const duration = durations[measureIndex];
    if (!duration) continue;
    const group = groups.get(beat) ?? {
      beat,
      measureIndex,
      fraction: harpPedalFractionFromNumber((beat - offsets[measureIndex]!) / duration),
      notes: [],
    };
    group.notes.push(note);
    groups.set(beat, group);
  }
  return [...groups.values()].sort((left, right) => left.beat - right.beat);
}

function isActiveHarpAt(part: Score["parts"][number], group: NoteGroup): boolean {
  return isHarpInstrumentAt(part, group.measureIndex, group.fraction);
}

function settingAt(
  tuning: HarpPedalTuning,
  measureIndex: number,
  fraction: [number, number],
): HarpPedalCalculatedSetting {
  return { measureIndex, fraction: [fraction[0], fraction[1]], tuning: { ...tuning } };
}

function requiredAlter(note: HarpPedalNote): HarpPedalAlter | undefined {
  const alter = note.pitch.alter;
  return alter === -1 || alter === 0 || alter === 1 ? alter : undefined;
}

function compatible(tuning: HarpPedalTuning, notes: readonly HarpPedalNote[]): boolean {
  return notes.every((note) => requiredAlter(note) === tuning[note.pitch.step]);
}

function heldNotesAt(notes: readonly HarpPedalNote[], beat: number): HarpPedalNote[] {
  return notes.filter((note) => note.beat < beat && note.beat + note.durationBeats > beat);
}

function extendConstraints(
  constraints: ReadonlyMap<HarpPedalLetter, HarpPedalAlter>,
  notes: readonly HarpPedalNote[],
): Map<HarpPedalLetter, HarpPedalAlter> | undefined {
  const next = new Map(constraints);
  for (const note of notes) {
    const alter = requiredAlter(note);
    const existing = next.get(note.pitch.step);
    if (alter === undefined || (existing !== undefined && existing !== alter)) return undefined;
    next.set(note.pitch.step, alter);
  }
  return next;
}

function longestCompatiblePrefix(
  groups: readonly NoteGroup[],
  start: number,
  part: Score["parts"][number],
  nextAnchorBeat: number | undefined,
): CompatiblePrefix | undefined {
  const constraints = new Map<HarpPedalLetter, HarpPedalAlter>();
  let boundary = start;
  for (; boundary < groups.length; boundary++) {
    const candidate = groups[boundary]!;
    if (!isActiveHarpAt(part, candidate) || (nextAnchorBeat !== undefined && candidate.beat >= nextAnchorBeat)) break;
    const extended = extendConstraints(constraints, candidate.notes);
    if (!extended) {
      if (boundary === start) return undefined;
      break;
    }
    constraints.clear();
    for (const [letter, alter] of extended) constraints.set(letter, alter);
  }
  return { boundary, constraints };
}

function tuningWithConstraints(
  state: HarpPedalTuning | undefined,
  constraints: ReadonlyMap<HarpPedalLetter, HarpPedalAlter>,
): HarpPedalTuning {
  const tuning: Record<HarpPedalLetter, HarpPedalAlter> = {
    ...(state ?? { D: 0, C: 0, B: 0, E: 0, F: 0, G: 0, A: 0 }),
  };
  for (const [letter, alter] of constraints) tuning[letter] = alter;
  return tuning;
}

function calculatedPlan(
  generated: HarpPedalCalculatedSetting[],
  anchors: readonly ManualAnchor[],
  durations: readonly number[],
  offsets: readonly number[],
): CalculationState {
  const entries = [
    ...generated.map((setting) => ({
      beat:
        offsets[setting.measureIndex]! + (setting.fraction[0] / setting.fraction[1]) * durations[setting.measureIndex]!,
      setting,
    })),
    ...anchors.map(({ beat, measureIndex, setting }) => ({
      beat,
      setting: {
        measureIndex,
        fraction: [...setting.position.fraction] as [number, number],
        tuning: setting.tuning,
      },
    })),
  ].sort((left, right) => left.beat - right.beat);
  let previous: HarpPedalTuning | undefined;
  let settingChanges = 0;
  let pedalMovements = 0;
  for (const entry of entries) {
    if (previous && !sameTuning(previous, entry.setting.tuning)) {
      settingChanges++;
      pedalMovements += PEDALS.filter((letter) => previous![letter] !== entry.setting.tuning[letter]).length;
    }
    previous = entry.setting.tuning;
  }
  return { settings: generated, settingChanges, pedalMovements };
}

function bestGreedyPlan(
  score: Score,
  partIndex: number,
  notes: readonly HarpPedalNote[],
): CalculationState | undefined {
  const part = score.parts[partIndex];
  if (!part) return undefined;
  const { durations, offsets } = measurePositions(score);
  const groups = groupNotes(notes, durations, offsets);
  const anchors = manualAnchors(part, durations, offsets);
  const generated: HarpPedalCalculatedSetting[] = [];
  let state: HarpPedalTuning | undefined;
  let groupIndex = 0;
  let anchorIndex = 0;

  while (groupIndex < groups.length || anchorIndex < anchors.length) {
    const group = groups[groupIndex];
    const anchor = anchors[anchorIndex];
    const nextBeat = Math.min(group?.beat ?? Infinity, anchor?.beat ?? Infinity);
    if (nextBeat === Infinity) break;

    if (anchor?.beat === nextBeat) {
      state = anchor.setting.tuning;
      const simultaneous = groups[groupIndex]?.beat === nextBeat ? groups[groupIndex]!.notes : [];
      if (!compatible(state, [...heldNotesAt(notes, nextBeat), ...simultaneous])) return undefined;
      anchorIndex++;
      if (group?.beat === nextBeat) groupIndex++;
      continue;
    }

    if (!group || !isActiveHarpAt(part, group)) {
      groupIndex++;
      state = undefined;
      continue;
    }

    if (state && compatible(state, group.notes)) {
      groupIndex++;
      continue;
    }

    const begin = groupIndex;
    const prefix = longestCompatiblePrefix(groups, begin, part, anchor?.beat);
    if (!prefix) return undefined;
    const tuning = tuningWithConstraints(state, prefix.constraints);
    const first = groups[begin]!;
    if (!compatible(tuning, heldNotesAt(notes, first.beat))) return undefined;
    if (!state || !sameTuning(state, tuning)) generated.push(settingAt(tuning, first.measureIndex, first.fraction));
    state = tuning;
    groupIndex = Math.max(prefix.boundary, begin + 1);
  }

  return calculatedPlan(generated, anchors, durations, offsets);
}

function solution(
  kind: HarpPedalSolutionKind,
  state: CalculationState,
  edits: HarpPedalSpellingEdit[],
): HarpPedalSolution {
  return {
    kind,
    settings: state.settings,
    spellingEdits: edits,
    settingChanges: state.settingChanges,
    pedalMovements: state.pedalMovements,
  };
}

/** Rank complete spelling-preserving and enharmonic tuning paths for a harp part. */
export function calculateHarpPedalSolutions(score: Score, partIndex: number): HarpPedalCalculation {
  const part = score.parts[partIndex];
  if (!part) return { solutions: [], error: "The harp part no longer exists." };
  const notes = collectHarpPedalNotes(score, partIndex).map((note) => ({
    ...note,
    beat: canonicalBeat(note.beat),
    durationBeats: canonicalBeat(note.beat + note.durationBeats) - canonicalBeat(note.beat),
  }));
  const ties = buildHarpTieChains(score, partIndex, notes);
  if (ties.error !== undefined) return { solutions: [], error: ties.error };
  const { chains, baselineNotes } = ties.music;
  if (!chains.length) return { solutions: [], error: "No written notes were found on this harp part." };
  const boundaries = harpSearchTimeline(score, partIndex, chains);
  if (typeof boundaries === "string") return { solutions: [], error: boundaries };
  const labels = searchHarpPedals(boundaries, chains);
  if (!labels.length) {
    return {
      solutions: [],
      error: "No harp pedal configuration satisfies the written pitches, held ties, and manual settings.",
    };
  }
  const zeroRespelling = labels.find((label) => label.respellingCount === 0);
  let noRespelling = zeroRespelling ? searchSolution(zeroRespelling, "no-respelling") : undefined;
  const canUseGreedy =
    chains.every((chain) => chain.choices.some((choice) => choice.edits.length === 0)) &&
    !part.measures.some((measure) => measure.instrumentChanges?.length);
  const greedy = canUseGreedy ? bestGreedyPlan(score, partIndex, baselineNotes) : undefined;
  if (greedy && noRespelling && compareTuningCost(greedy, noRespelling) <= 0) {
    noRespelling = solution("no-respelling", greedy, []);
  }
  const alternatives = labels
    .filter((label) => label.respellingCount > 0 && (!noRespelling || compareTuningCost(label, noRespelling) < 0))
    .sort((left, right) => left.respellingCount - right.respellingCount || compareSearchLabels(left, right));
  const suggested = alternatives[0];
  const maximum = labels[0]!;
  const solutions: HarpPedalSolution[] = noRespelling ? [noRespelling] : [];
  if (suggested) {
    solutions.push(searchSolution(suggested, "suggest-respelling"));
    if (compareTuningCost(maximum, suggested) < 0) solutions.push(searchSolution(maximum, "maximum-respell"));
  }
  return { solutions };
}
