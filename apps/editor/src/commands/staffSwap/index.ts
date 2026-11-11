import { walkSequenceEvents, type PartMeasure, type Score, type SequenceContent } from "@viritura/core";
import type { SelectionState } from "../../store/selectionStore";
import { measureSelectionStaffOffsets, partStaffOffset } from "../../clipboard/clipboardTrackMapping";
import { cloneScore } from "../../score/scoreClone";

interface StaffTarget {
  partIndex: number;
  staff: number;
}

interface StaffSwapTarget {
  staves: [StaffTarget, StaffTarget];
  startMeasure: number;
  endMeasure: number;
}

export function resolveStaffSwapTarget(score: Score | null, selection: SelectionState): StaffSwapTarget | null {
  if (!score || selection.kind !== "measure") return null;
  const startMeasure = Math.min(selection.startMeasure, selection.endMeasure);
  const endMeasure = Math.max(selection.startMeasure, selection.endMeasure);
  const startPart = Math.min(selection.startPartIndex, selection.endPartIndex);
  const endPart = Math.max(selection.startPartIndex, selection.endPartIndex);
  if (![startMeasure, endMeasure, startPart, endPart].every(Number.isInteger)) return null;
  if (
    startMeasure < 0 ||
    endMeasure >= score.global.measures.length ||
    startPart < 0 ||
    endPart >= score.parts.length
  ) {
    return null;
  }
  const offsets = measureSelectionStaffOffsets(score, selection);
  for (const [partIndex, localStaffIndex] of [
    [selection.startPartIndex, selection.startLocalStaffIndex],
    [selection.endPartIndex, selection.endLocalStaffIndex],
  ] as const) {
    if (
      localStaffIndex !== undefined &&
      (!Number.isInteger(localStaffIndex) ||
        localStaffIndex < 0 ||
        localStaffIndex >= (score.parts[partIndex]!.staves ?? 1))
    )
      return null;
  }
  const staves: StaffTarget[] = [];
  for (let partIndex = startPart; partIndex <= endPart; partIndex++) {
    const part = score.parts[partIndex]!;
    if (!part.measures[startMeasure] || !part.measures[endMeasure]) return null;
    for (let staff = 1; staff <= (part.staves ?? 1); staff++) {
      const offset = partStaffOffset(score, startPart, partIndex, staff);
      if (!offsets || (offset >= offsets.start && offset <= offsets.end)) staves.push({ partIndex, staff });
    }
  }
  if (staves.length !== 2) return null;
  return { staves: [staves[0]!, staves[1]!], startMeasure, endMeasure };
}

function remapStaff(staff: number, from: StaffTarget, to: StaffTarget): number {
  // Cross-staff targets cannot follow music into a different instrument's part.
  if (from.partIndex !== to.partIndex) return to.staff;
  if (staff === from.staff) return to.staff;
  if (staff === to.staff) return from.staff;
  return staff;
}

function remapContent(content: SequenceContent[], from: StaffTarget, to: StaffTarget): void {
  for (const item of content) {
    if ((item.type === "event" || item.type === "tuplet") && item.staff !== undefined) {
      item.staff = remapStaff(item.staff, from, to);
    }
    if ("content" in item) remapContent(item.content, from, to);
  }
}

function contentIds(measure: PartMeasure, staff: number): Set<string> {
  const ids = new Set<string>();
  for (const sequence of measure.sequences) {
    if ((sequence.staff ?? 1) !== staff) continue;
    for (const { event } of walkSequenceEvents(sequence.content)) {
      if (event.id) ids.add(event.id);
      for (const note of event.notes ?? []) if (note.id) ids.add(note.id);
    }
  }
  return ids;
}

function exchangeStaffValues<T extends { staff?: number; staffEnd?: number }>(
  first: T[] | undefined,
  second: T[] | undefined,
  from: StaffTarget,
  to: StaffTarget,
): [T[] | undefined, T[] | undefined] {
  const moved = (values: T[] | undefined, source: StaffTarget, destination: StaffTarget): T[] =>
    (values ?? [])
      .filter((value) => (value.staff ?? 1) === source.staff)
      .map((value) => ({
        ...value,
        staff: destination.staff,
        ...(value.staffEnd === undefined ? {} : { staffEnd: remapStaff(value.staffEnd, source, destination) }),
      }));
  if (from.partIndex === to.partIndex) {
    const values = first?.map((value) => ({
      ...value,
      staff: remapStaff(value.staff ?? 1, from, to),
      ...(value.staffEnd === undefined ? {} : { staffEnd: remapStaff(value.staffEnd, from, to) }),
    }));
    return [values, values];
  }
  const combine = (retained: T[], incoming: T[]): T[] | undefined =>
    retained.length + incoming.length > 0 ? [...retained, ...incoming] : undefined;
  return [
    combine(
      (first ?? []).filter((value) => (value.staff ?? 1) !== from.staff),
      moved(second, to, from),
    ),
    combine(
      (second ?? []).filter((value) => (value.staff ?? 1) !== to.staff),
      moved(first, from, to),
    ),
  ];
}

function exchangeReferencedValues<T>(
  first: T[] | undefined,
  second: T[] | undefined,
  firstIds: ReadonlySet<string>,
  secondIds: ReadonlySet<string>,
  references: (value: T) => string[],
): [T[] | undefined, T[] | undefined] {
  const belongs = (value: T, ids: ReadonlySet<string>) => references(value).some((id) => ids.has(id));
  const combine = (retained: T[], incoming: T[]): T[] | undefined =>
    retained.length + incoming.length > 0 ? [...retained, ...incoming] : undefined;
  return [
    combine(
      (first ?? []).filter((value) => !belongs(value, firstIds)),
      (second ?? []).filter((value) => belongs(value, secondIds)),
    ),
    combine(
      (second ?? []).filter((value) => !belongs(value, secondIds)),
      (first ?? []).filter((value) => belongs(value, firstIds)),
    ),
  ];
}

function exchangeAnnotations(first: PartMeasure, second: PartMeasure, from: StaffTarget, to: StaffTarget): void {
  [first.dynamics, second.dynamics] = exchangeStaffValues(first.dynamics, second.dynamics, from, to);
  [first.expressions, second.expressions] = exchangeStaffValues(first.expressions, second.expressions, from, to);
  [first.pedals, second.pedals] = exchangeStaffValues(first.pedals, second.pedals, from, to);
  [first.ottavas, second.ottavas] = exchangeStaffValues(first.ottavas, second.ottavas, from, to);
}

/** Move existing identities with their music; do not copy, transpose, or touch the clipboard. */
export function swapStaffContents(score: Score, selection: SelectionState): Score | null {
  const target = resolveStaffSwapTarget(score, selection);
  if (!target) return null;
  const next = cloneScore(score);
  const [from, to] = target.staves;
  for (let index = target.startMeasure; index <= target.endMeasure; index++) {
    const first = next.parts[from.partIndex]!.measures[index]!;
    const second = next.parts[to.partIndex]!.measures[index]!;
    const firstIds = contentIds(first, from.staff);
    const secondIds = contentIds(second, to.staff);
    const firstSequences = first.sequences.filter((sequence) => (sequence.staff ?? 1) === from.staff);
    const secondSequences = second.sequences.filter((sequence) => (sequence.staff ?? 1) === to.staff);
    for (const sequence of firstSequences) {
      sequence.staff = to.staff;
      remapContent(sequence.content, from, to);
    }
    for (const sequence of secondSequences) {
      sequence.staff = from.staff;
      remapContent(sequence.content, to, from);
    }
    if (first !== second) {
      const firstSet = new Set(firstSequences);
      const secondSet = new Set(secondSequences);
      first.sequences = [...first.sequences.filter((sequence) => !firstSet.has(sequence)), ...secondSequences];
      second.sequences = [...second.sequences.filter((sequence) => !secondSet.has(sequence)), ...firstSequences];
      [first.beams, second.beams] = exchangeReferencedValues(
        first.beams,
        second.beams,
        firstIds,
        secondIds,
        (beam) => beam.events,
      );
      [first.arpeggios, second.arpeggios] = exchangeReferencedValues(
        first.arpeggios,
        second.arpeggios,
        firstIds,
        secondIds,
        (value) => [value.span.start, value.span.end],
      );
      [first.nonArpeggios, second.nonArpeggios] = exchangeReferencedValues(
        first.nonArpeggios,
        second.nonArpeggios,
        firstIds,
        secondIds,
        (value) => [value.span.start, value.span.end],
      );
      if ((next.parts[from.partIndex]!.staves ?? 1) === 1 && (next.parts[to.partIndex]!.staves ?? 1) === 1) {
        [first.measureRepeat, second.measureRepeat] = [second.measureRepeat, first.measureRepeat];
      }
    }
    exchangeAnnotations(first, second, from, to);
  }
  return next;
}
