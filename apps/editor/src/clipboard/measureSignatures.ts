import type { PositionedClef, Score, Space } from "@viritura/core";
import type { CapturedMeasureSignatures, ClipboardTrack } from "./ClipboardFragment";
import { addWholeFractions, compareWholeFractions } from "./clipboardTrackPlacement";
import { resolveActiveTimeKey } from "./sourceContext";
import { resolvePhysicalStaffDestination } from "./annotations";
import { ensurePasteMeasure } from "./pasteContent";

function initialClef(score: Score, partIndex: number, measureIndex: number, staff: number): PositionedClef | undefined {
  for (let m = measureIndex; m >= 0; m--) {
    const entries = score.parts[partIndex]?.measures[m]?.clefs?.filter(
      (entry) =>
        (entry.staff ?? 1) === staff &&
        (m !== measureIndex || compareWholeFractions(entry.position?.fraction ?? [0, 1], [0, 1]) === 0),
    );
    const latest = entries
      ?.sort((a, b) => compareWholeFractions(a.position?.fraction ?? [0, 1], b.position?.fraction ?? [0, 1]))
      .at(-1);
    if (latest) return { ...structuredClone(latest), position: { fraction: [0, 1] } };
  }
  return undefined;
}

export function captureMeasureSignatures(
  score: Score,
  startPart: number,
  startMeasure: number,
  endMeasure: number,
  tracks: ClipboardTrack[],
): CapturedMeasureSignatures[] {
  const staves = [
    ...new Map(
      tracks.map((track) => [
        track.staffOffset,
        { partIndex: startPart + track.partOffset, staff: track.sourceStaff ?? 1, staffOffset: track.staffOffset! },
      ]),
    ).values(),
  ];
  const signatures: CapturedMeasureSignatures[] = [];
  let offset: Space["duration"] = [0, 1];
  for (let m = startMeasure; m <= endMeasure; m++) {
    const { time, key } = resolveActiveTimeKey(score, m);
    const clefs: NonNullable<CapturedMeasureSignatures["clefs"]> = [];
    for (const source of staves) {
      const entries =
        score.parts[source.partIndex]?.measures[m]?.clefs?.filter((entry) => (entry.staff ?? 1) === source.staff) ?? [];
      const initial = m === startMeasure ? initialClef(score, source.partIndex, m, source.staff) : undefined;
      if (initial) clefs.push({ staffOffset: source.staffOffset, clef: initial });
      for (const entry of entries) {
        if (initial && compareWholeFractions(entry.position?.fraction ?? [0, 1], [0, 1]) === 0) continue;
        clefs.push({ staffOffset: source.staffOffset, clef: structuredClone(entry) });
      }
    }
    signatures.push({
      offset,
      duration: [time.count, time.unit],
      staffOffsets: staves.map((source) => source.staffOffset),
      key: m === startMeasure ? structuredClone(key) : structuredClone(score.global.measures[m]?.key),
      clefs,
    });
    offset = addWholeFractions(offset, [time.count, time.unit]);
  }
  return signatures;
}

type SignaturePosition = { measureIndex: number; fraction: Space["duration"] };

function clearDestinationSignatures(
  score: Score,
  signatures: CapturedMeasureSignatures[],
  partIndex: number,
  staffIndex: number,
  locate: (offset: Space["duration"]) => SignaturePosition,
): void {
  const first = signatures[0];
  if (!first) return;
  const firstMeasure = locate(first.offset).measureIndex;
  for (const entry of signatures) {
    const start = locate(entry.offset);
    const end = locate(addWholeFractions(entry.offset, entry.duration));
    const destinations = entry.staffOffsets.map((offset) =>
      resolvePhysicalStaffDestination(score, partIndex, staffIndex, offset),
    );
    for (let m = start.measureIndex; m <= end.measureIndex; m++) {
      if (m === end.measureIndex && end.fraction[0] === 0) break;
      ensurePasteMeasure(score, m);
      if (m !== firstMeasure) delete score.global.measures[m]!.key;
      for (const destination of destinations) {
        const measure = score.parts[destination.partIndex]!.measures[m]!;
        if (!measure.clefs) continue;
        measure.clefs = measure.clefs.filter((clef) => {
          if ((clef.staff ?? 1) !== destination.staffIndex + 1) return true;
          const position = clef.position?.fraction ?? [0, 1];
          return (
            (m === start.measureIndex && compareWholeFractions(position, start.fraction) < 0) ||
            (m === end.measureIndex && compareWholeFractions(position, end.fraction) >= 0)
          );
        });
      }
    }
  }
}

export function applyMeasureSignatures(
  score: Score,
  signatures: CapturedMeasureSignatures[] | undefined,
  partIndex: number,
  staffIndex: number,
  locate: (offset: Space["duration"]) => SignaturePosition,
): void {
  clearDestinationSignatures(score, signatures ?? [], partIndex, staffIndex, locate);
  for (const signaturesAtMeasure of signatures ?? []) {
    if (signaturesAtMeasure.key) {
      const target = locate(signaturesAtMeasure.offset);
      ensurePasteMeasure(score, target.measureIndex);
      const measure = score.global.measures[target.measureIndex]!;
      const unchangedContext =
        signaturesAtMeasure.offset[0] === 0 &&
        !measure.key &&
        JSON.stringify(resolveActiveTimeKey(score, target.measureIndex).key) ===
          JSON.stringify(signaturesAtMeasure.key);
      if (!unchangedContext) measure.key = structuredClone(signaturesAtMeasure.key);
    }
    for (const entry of signaturesAtMeasure.clefs ?? []) {
      const destination = resolvePhysicalStaffDestination(score, partIndex, staffIndex, entry.staffOffset);
      const target = locate(addWholeFractions(signaturesAtMeasure.offset, entry.clef.position?.fraction ?? [0, 1]));
      ensurePasteMeasure(score, target.measureIndex);
      const measure = score.parts[destination.partIndex]!.measures[target.measureIndex]!;
      const staff = destination.staffIndex + 1;
      const clefs = (measure.clefs ?? []).filter(
        (clef) =>
          (clef.staff ?? 1) !== staff ||
          compareWholeFractions(clef.position?.fraction ?? [0, 1], target.fraction) !== 0,
      );
      clefs.push({ ...structuredClone(entry.clef), staff, position: { fraction: target.fraction } });
      measure.clefs = clefs.sort((a, b) =>
        compareWholeFractions(a.position?.fraction ?? [0, 1], b.position?.fraction ?? [0, 1]),
      );
    }
  }
}
