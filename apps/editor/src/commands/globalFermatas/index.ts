import {
  canonicalGlobalFermatas,
  collectMeasureEventSpans,
  fermataPositionKey,
  fermataMultiplier,
  generateId,
  type GlobalFermata,
  type Score,
  type Fermata,
  type FermataDuration,
  type FermataSymbol,
} from "@viritura/core";
import { beatPositionToFraction } from "../../app/timedAnnotationPosition";
import { resolveGlobalFermata, resolveFullMeasureRestLocation } from "../../score/ElementPath";
import { resolveCondensedSelectionEvents } from "../../score/condensedWriteback";
import { resolveSelectionEvents } from "../../store/selectionUtils";
import type { Selection } from "../../store/selectionStore";

export function mergeGlobalFermata(
  score: Score,
  measureIndex: number,
  position: GlobalFermata["position"],
  multiplier = 2,
): void {
  const measure = score.global.measures[measureIndex];
  if (!measure) return;
  if (measure.fermatas?.some((item) => fermataPositionKey(item.position) === fermataPositionKey(position))) return;
  measure.fermatas = canonicalGlobalFermatas([
    ...(measure.fermatas ?? []),
    {
      id: generateId(),
      position,
      ...(multiplier === 2 ? {} : { multiplier }),
    },
  ]);
}

const SHAPE_DURATION: Partial<Record<FermataSymbol, FermataDuration>> = {
  doubleAngled: "veryShort",
  angled: "short",
  square: "long",
  doubleSquare: "veryLong",
  doubleDot: "long",
  halfCurve: "short",
};

function localPresentation(carrier: { fermata?: Fermata }, presentation: Pick<Fermata, "symbol" | "duration">): void {
  if (!presentation.symbol || presentation.symbol === "normal") return;
  const local = carrier.fermata;
  carrier.fermata = {
    ...local,
    symbol: presentation.symbol,
    _x: { ...local?._x, viritura: { ...local?._x?.viritura, localOnly: true } },
  };
}

function selectionElementIds(selection: Selection): string[] {
  if (selection.kind === "single") return [selection.elementId];
  if (selection.kind === "multi") return [...selection.elementIds];
  if (selection.kind === "range") return [selection.startElementId, selection.endElementId];
  return [];
}

export function applyGlobalFermata(
  score: Score,
  selection: Selection,
  scoreIndex?: number,
  presentation: Pick<Fermata, "symbol" | "duration"> = {},
): Score | null {
  const result = structuredClone(score);
  const multiplier = fermataMultiplier({
    duration: presentation.duration ?? SHAPE_DURATION[presentation.symbol ?? "normal"],
  });
  const events =
    scoreIndex === undefined
      ? resolveSelectionEvents(selection, score)
      : resolveCondensedSelectionEvents(score, selection, scoreIndex);
  let found = false;
  const spansByMeasure = new Map<number, ReturnType<typeof collectMeasureEventSpans>>();
  for (const location of events) {
    const path =
      location.contentPath ??
      (location.tupletIndex === undefined ? [location.eventIndex] : [location.tupletIndex, location.eventIndex]);
    let spans = spansByMeasure.get(location.measureIndex);
    if (!spans) {
      spans = collectMeasureEventSpans(result, location.measureIndex);
      spansByMeasure.set(location.measureIndex, spans);
    }
    const span = spans.find(
      (item) =>
        item.partIndex === location.partIndex &&
        item.sequenceIndex === location.sequenceIndex &&
        item.contentPath.join("/") === path.join("/"),
    );
    if (!span) continue;
    mergeGlobalFermata(result, location.measureIndex, { fraction: beatPositionToFraction(span.onset) }, multiplier);
    if (span.event) localPresentation(span.event, presentation);
    found = true;
  }
  if (selection.kind === "range") {
    const start = resolveFullMeasureRestLocation(selection.startElementId, score);
    const end = resolveFullMeasureRestLocation(selection.endElementId, score);
    if (start && end) {
      for (
        let mi = Math.min(start.measureIndex, end.measureIndex);
        mi <= Math.max(start.measureIndex, end.measureIndex);
        mi++
      ) {
        mergeGlobalFermata(result, mi, { fraction: [0, 1] }, multiplier);
        found = true;
      }
    }
  }
  for (const id of selectionElementIds(selection)) {
    const rest = resolveFullMeasureRestLocation(id, score);
    if (!rest) continue;
    mergeGlobalFermata(result, rest.measureIndex, { fraction: [0, 1] }, multiplier);
    const fullMeasure =
      result.parts[rest.partIndex]?.measures[rest.measureIndex]?.sequences[rest.sequenceIndex]?.fullMeasure;
    if (fullMeasure) localPresentation(fullMeasure, presentation);
    found = true;
  }
  if (selection.kind === "measure") {
    for (
      let mi = Math.min(selection.startMeasure, selection.endMeasure);
      mi <= Math.max(selection.startMeasure, selection.endMeasure);
      mi++
    ) {
      mergeGlobalFermata(result, mi, { fraction: [0, 1] }, multiplier);
      found = true;
    }
  }
  return found ? result : null;
}

export function removeGlobalFermata(score: Score, elementId: string): Score | null {
  const target = resolveGlobalFermata(elementId, score);
  if (!target) return null;
  const measure = score.global.measures[target.measureIndex]!;
  measure.fermatas = measure.fermatas!.filter((item) => item.id !== target.fermata.id);
  if (measure.fermatas.length === 0) delete measure.fermatas;
  return score;
}
