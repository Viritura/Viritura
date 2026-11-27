import type { HarpPedalAlter, HarpPedalLetter, HarpPedalTuning } from "./index";
import type { HarpPedalCalculatedSetting, HarpPedalSpellingEdit } from "./calculator";

export const PEDAL_LETTERS: readonly HarpPedalLetter[] = ["D", "C", "B", "E", "F", "G", "A"];
const POWERS = PEDAL_LETTERS.map((_, index) => 3 ** index);
export const TUNING_COUNT = 3 ** PEDAL_LETTERS.length;

export const PEDAL_TUNINGS: readonly HarpPedalTuning[] = Array.from({ length: TUNING_COUNT }, (_, index) => {
  const tuning: Record<HarpPedalLetter, HarpPedalAlter> = { D: 0, C: 0, B: 0, E: 0, F: 0, G: 0, A: 0 };
  PEDAL_LETTERS.forEach((letter, axis) => {
    const digit = Math.floor(index / POWERS[axis]!) % 3;
    tuning[letter] = digit === 0 ? -1 : digit === 1 ? 0 : 1;
  });
  return tuning;
});

export interface SearchPath {
  previous?: SearchPath;
  setting?: HarpPedalCalculatedSetting;
  edits: readonly HarpPedalSpellingEdit[];
}

export interface SearchLabel {
  tuningIndex: number;
  assignments: ReadonlyMap<number, number>;
  settingChanges: number;
  pedalMovements: number;
  respellingCount: number;
  preference: number;
  editKey: string;
  path?: SearchPath;
}

export interface PedalTransfer {
  origin: SearchLabel;
  settingChanges: number;
  pedalMovements: number;
}

interface DistanceRoute {
  origin: SearchLabel;
  distance: number;
}

type PedalCost = Pick<SearchLabel, "settingChanges" | "pedalMovements">;

export function comparePedalCost(left: PedalCost, right: PedalCost): number {
  return left.settingChanges - right.settingChanges || left.pedalMovements - right.pedalMovements;
}

function comparePreference(left: SearchLabel, right: SearchLabel): number {
  return left.editKey.localeCompare(right.editKey) || left.preference - right.preference;
}

export function compareSearchLabels(left: SearchLabel, right: SearchLabel): number {
  return (
    comparePedalCost(left, right) || left.respellingCount - right.respellingCount || comparePreference(left, right)
  );
}

export function assignmentKey(assignments: ReadonlyMap<number, number>): string {
  return [...assignments]
    .sort(([left], [right]) => left - right)
    .map(([chain, choice]) => `${chain}:${choice}`)
    .join(",");
}

export function pruneSearchLabels(labels: Iterable<SearchLabel>): SearchLabel[] {
  const fronts = new Map<string, SearchLabel[]>();
  for (const label of labels) {
    const key = `${label.tuningIndex}/${assignmentKey(label.assignments)}`;
    const front = fronts.get(key) ?? [];
    const dominated = front.some(
      (other) =>
        other.respellingCount <= label.respellingCount &&
        comparePedalCost(other, label) <= 0 &&
        (other.respellingCount !== label.respellingCount || compareSearchLabels(other, label) <= 0),
    );
    if (dominated) continue;
    const retained = front.filter(
      (other) => other.respellingCount < label.respellingCount || comparePedalCost(other, label) < 0,
    );
    retained.push(label);
    fronts.set(key, retained);
  }
  return [...fronts.values()].flat();
}

export function tuningIndex(tuning: HarpPedalTuning): number {
  return PEDAL_LETTERS.reduce((index, letter, axis) => index + (tuning[letter] + 1) * POWERS[axis]!, 0);
}

function movedPedals(left: number, right: number): number {
  let moved = 0;
  for (const power of POWERS) {
    if (Math.floor(left / power) % 3 !== Math.floor(right / power) % 3) moved++;
  }
  return moved;
}

function transfer(origin: SearchLabel, target: number): PedalTransfer {
  const changed = origin.tuningIndex >= 0 && origin.tuningIndex !== target;
  return {
    origin,
    settingChanges: origin.settingChanges + (changed ? 1 : 0),
    pedalMovements: origin.pedalMovements + (changed ? movedPedals(origin.tuningIndex, target) : 0),
  };
}

function compareTransfers(left: PedalTransfer, right: PedalTransfer): number {
  return comparePedalCost(left, right) || comparePreference(left.origin, right.origin);
}

function compareRoutes(left: DistanceRoute, right: DistanceRoute): number {
  return (
    left.origin.settingChanges - right.origin.settingChanges ||
    left.origin.pedalMovements + left.distance - right.origin.pedalMovements - right.distance ||
    comparePreference(left.origin, right.origin)
  );
}

function distanceRoutes(labels: readonly SearchLabel[]): (DistanceRoute | undefined)[] {
  let routes: (DistanceRoute | undefined)[] = Array.from({ length: TUNING_COUNT });
  for (const origin of labels) {
    if (origin.tuningIndex < 0) continue;
    const route = { origin, distance: 0 };
    const existing = routes[origin.tuningIndex];
    if (!existing || compareRoutes(route, existing) < 0) routes[origin.tuningIndex] = route;
  }
  // A seven-axis Hamming transform finds the best changed tuning without a 2,187-by-2,187 scan.
  for (const power of POWERS) {
    const next = [...routes];
    for (let index = 0; index < TUNING_COUNT; index++) {
      const digit = Math.floor(index / power) % 3;
      for (let otherDigit = 0; otherDigit < 3; otherDigit++) {
        if (otherDigit === digit) continue;
        const previous = routes[index + (otherDigit - digit) * power];
        if (!previous) continue;
        const candidate = { origin: previous.origin, distance: previous.distance + 1 };
        const existing = next[index];
        if (!existing || compareRoutes(candidate, existing) < 0) next[index] = candidate;
      }
    }
    routes = next;
  }
  return routes;
}

export function bestPedalTransfers(
  labels: readonly SearchLabel[],
  targets: readonly number[],
): Map<number, PedalTransfer> {
  const result = new Map<number, PedalTransfer>();
  if (targets.length * labels.length <= TUNING_COUNT * 2) {
    for (const target of targets) {
      for (const label of labels) {
        const candidate = transfer(label, target);
        const previous = result.get(target);
        if (!previous || compareTransfers(candidate, previous) < 0) result.set(target, candidate);
      }
    }
    return result;
  }
  const routes = distanceRoutes(labels);
  const unchanged = new Map(
    labels.filter((label) => label.tuningIndex >= 0).map((label) => [label.tuningIndex, label]),
  );
  const unknown = labels.filter((label) => label.tuningIndex < 0).sort(compareSearchLabels)[0];
  for (const target of targets) {
    const route = routes[target];
    const same = unchanged.get(target);
    const candidates = [route?.origin, same, unknown]
      .filter((label): label is SearchLabel => label !== undefined)
      .map((label) => transfer(label, target));
    candidates.sort(compareTransfers);
    if (candidates[0]) result.set(target, candidates[0]);
  }
  return result;
}
