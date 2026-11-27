import type { HarpPedalSolution } from "./calculator";
import type { HarpSearchBoundary } from "./calculationTimeline";
import type { HarpSpellingChain, HarpSpellingChoice } from "./tieChains";
import {
  assignmentKey,
  bestPedalTransfers,
  compareSearchLabels,
  PEDAL_LETTERS,
  PEDAL_TUNINGS,
  pruneSearchLabels,
  tuningIndex,
  type PedalTransfer,
  type SearchLabel,
} from "./searchTransitions";

interface SpellingVariant {
  assignments: ReadonlyMap<number, number>;
  edits: HarpSpellingChoice["edits"];
  editKeys: string[];
}

function candidateTunings(boundaries: readonly HarpSearchBoundary[], chains: readonly HarpSpellingChain[]): number[] {
  const alterations = new Map(PEDAL_LETTERS.map((letter) => [letter, new Set<number>([0])]));
  for (const chain of chains) {
    for (const choice of chain.choices) alterations.get(choice.pitch.step)!.add(choice.pitch.alter);
  }
  for (const boundary of boundaries) {
    if (!boundary.anchor) continue;
    for (const letter of PEDAL_LETTERS) alterations.get(letter)!.add(boundary.anchor.tuning[letter]);
  }
  // An alteration never requested by any string or anchor is dominated by its natural replacement.
  return PEDAL_TUNINGS.flatMap((tuning, index) =>
    PEDAL_LETTERS.every((letter) => alterations.get(letter)!.has(tuning[letter])) ? [index] : [],
  );
}

function retainsChoice(chain: HarpSpellingChain, beat: number | undefined): boolean {
  return beat !== undefined && (chain.endBeat > beat || chain.lastAttackBeat >= beat);
}

function retainedAssignments(
  assignments: ReadonlyMap<number, number>,
  chains: readonly HarpSpellingChain[],
  beat: number | undefined,
): Map<number, number> {
  return new Map([...assignments].filter(([id]) => retainsChoice(chains[id]!, beat)));
}

function sourcePartitions(labels: readonly SearchLabel[]): SearchLabel[][] {
  const groups = new Map<string, SearchLabel[]>();
  for (const label of labels) {
    const key = `${assignmentKey(label.assignments)}/${label.respellingCount}`;
    const group = groups.get(key) ?? [];
    group.push(label);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function startChoices(boundary: HarpSearchBoundary, index: number): number[][] {
  const tuning = PEDAL_TUNINGS[index]!;
  return boundary.starts.map((chain) =>
    chain.choices
      .map((choice, choiceIndex) => ({ choice, choiceIndex }))
      .filter(({ choice }) => tuning[choice.pitch.step] === choice.pitch.alter)
      .sort(
        (left, right) =>
          left.choice.edits.length - right.choice.edits.length ||
          left.choice.editKeys.join(";").localeCompare(right.choice.editKeys.join(";")),
      )
      .map(({ choiceIndex }) => choiceIndex),
  );
}

function eligibleTargets(
  boundary: HarpSearchBoundary,
  assignments: ReadonlyMap<number, number>,
  chains: readonly HarpSpellingChain[],
  choices: ReadonlyMap<number, number[][]>,
): number[] {
  const indices = boundary.anchor ? [tuningIndex(boundary.anchor.tuning)] : [...choices.keys()];
  return indices.filter((index) => {
    if (choices.get(index)?.some((options) => options.length === 0)) return false;
    const tuning = PEDAL_TUNINGS[index]!;
    for (const [id, choiceIndex] of assignments) {
      if (!boundary.required.has(id)) continue;
      const pitch = chains[id]!.choices[choiceIndex]!.pitch;
      if (tuning[pitch.step] !== pitch.alter) return false;
    }
    return true;
  });
}

function* spellingVariants(
  starts: readonly HarpSpellingChain[],
  options: readonly number[][],
  assignments: ReadonlyMap<number, number>,
  nextBeat: number | undefined,
  index = 0,
  edits: HarpSpellingChoice["edits"] = [],
  editKeys: string[] = [],
): Generator<SpellingVariant> {
  const chain = starts[index];
  if (!chain) {
    yield { assignments, edits, editKeys };
    return;
  }
  const retaining = retainsChoice(chain, nextBeat);
  const indices = retaining ? options[index]! : options[index]!.slice(0, 1);
  for (const choiceIndex of indices) {
    const choice = chain.choices[choiceIndex]!;
    const nextAssignments = new Map(assignments);
    if (retaining) nextAssignments.set(chain.id, choiceIndex);
    yield* spellingVariants(
      starts,
      options,
      nextAssignments,
      nextBeat,
      index + 1,
      [...edits, ...choice.edits],
      [...editKeys, ...choice.editKeys],
    );
  }
}

function candidateLabel(
  transfer: PedalTransfer,
  target: number,
  variant: SpellingVariant,
  boundary: HarpSearchBoundary,
): SearchLabel {
  const origin = transfer.origin;
  const tuning = PEDAL_TUNINGS[target]!;
  const setting =
    !boundary.anchor && origin.tuningIndex !== target
      ? { measureIndex: boundary.measureIndex, fraction: [...boundary.fraction] as [number, number], tuning }
      : undefined;
  const path = setting || variant.edits.length ? { previous: origin.path, setting, edits: variant.edits } : origin.path;
  const editKeys = origin.editKey ? origin.editKey.split(";") : [];
  return {
    tuningIndex: target,
    assignments: variant.assignments,
    settingChanges: transfer.settingChanges,
    pedalMovements: transfer.pedalMovements,
    respellingCount: origin.respellingCount + variant.edits.length,
    preference: origin.preference + (setting ? PEDAL_LETTERS.filter((letter) => tuning[letter] !== 0).length : 0),
    editKey: [...editKeys, ...variant.editKeys].sort().join(";"),
    path,
  };
}

function* advanceCandidates(
  labels: readonly SearchLabel[],
  boundary: HarpSearchBoundary,
  chains: readonly HarpSpellingChain[],
  nextBeat: number | undefined,
  tuningIndices: readonly number[],
): Generator<SearchLabel> {
  const choices = new Map(tuningIndices.map((index) => [index, startChoices(boundary, index)]));
  const targetsByAssignments = new Map<string, number[]>();
  for (const partition of sourcePartitions(labels)) {
    const assignments = partition[0]!.assignments;
    const key = assignmentKey(assignments);
    let targets = targetsByAssignments.get(key);
    if (!targets) {
      targets = eligibleTargets(boundary, assignments, chains, choices);
      targetsByAssignments.set(key, targets);
    }
    const transfers = bestPedalTransfers(partition, targets);
    const carried = retainedAssignments(assignments, chains, nextBeat);
    for (const [target, transfer] of transfers) {
      for (const variant of spellingVariants(boundary.starts, choices.get(target)!, carried, nextBeat)) {
        yield candidateLabel(transfer, target, variant, boundary);
      }
    }
  }
}

/** Keep nondominated pedal-cost/respelling paths, including physical-string assignments while notes are held. */
export function searchHarpPedals(
  boundaries: readonly HarpSearchBoundary[],
  chains: readonly HarpSpellingChain[],
): SearchLabel[] {
  const tuningIndices = candidateTunings(boundaries, chains);
  let labels: SearchLabel[] = [
    {
      tuningIndex: -1,
      assignments: new Map(),
      settingChanges: 0,
      pedalMovements: 0,
      respellingCount: 0,
      preference: 0,
      editKey: "",
    },
  ];
  for (const [index, boundary] of boundaries.entries()) {
    labels = pruneSearchLabels(
      labels.map((label) => ({
        ...label,
        tuningIndex: boundary.reset ? -1 : label.tuningIndex,
        assignments: retainedAssignments(label.assignments, chains, boundary.beat),
      })),
    );
    if (!boundary.harp) continue;
    const unknownAndUnused =
      !boundary.anchor &&
      !boundary.starts.length &&
      labels.every(
        (label) => label.tuningIndex < 0 && ![...label.assignments.keys()].some((id) => boundary.required.has(id)),
      );
    if (unknownAndUnused) continue;
    labels = pruneSearchLabels(advanceCandidates(labels, boundary, chains, boundaries[index + 1]?.beat, tuningIndices));
    if (!labels.length) break;
  }
  return labels.sort(compareSearchLabels);
}

export function searchSolution(label: SearchLabel, kind: HarpPedalSolution["kind"]): HarpPedalSolution {
  const settings: HarpPedalSolution["settings"] = [];
  const spellingEdits: HarpPedalSolution["spellingEdits"] = [];
  for (let path = label.path; path; path = path.previous) {
    if (path.setting) settings.push(path.setting);
    spellingEdits.push(...path.edits);
  }
  return {
    kind,
    settings: settings.reverse(),
    spellingEdits: spellingEdits.sort(
      (left, right) => left.eventId.localeCompare(right.eventId) || left.noteIndex - right.noteIndex,
    ),
    settingChanges: label.settingChanges,
    pedalMovements: label.pedalMovements,
  };
}
