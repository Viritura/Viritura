import type { Fermata, GlobalFermata, Score } from "../model";
import { generateId } from "../id";
import { DiagnosticCollector, ptr } from "../diagnostics";
import { canonicalGlobalFermatas, fermataMultiplier, fermataPositionKey } from "./identity";
import { collectScoreEventSpans, type FermataEventSpan } from "./projection";

function carrier(span: FermataEventSpan): { fermata?: Fermata } {
  const value = span.event ?? span.sequence.fullMeasure;
  if (!value) throw new Error("Fermata projection has no event or full-measure rest.");
  return value;
}

function vendor(fermata: Fermata | undefined): Record<string, unknown> | undefined {
  const value = fermata?._x?.["viritura"];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function hasLocalPresentation(fermata: Fermata | undefined): boolean {
  return (
    !!fermata &&
    ((fermata.symbol !== undefined && fermata.symbol !== "normal") ||
      (fermata.placement !== undefined && fermata.placement !== "auto") ||
      (fermata.pointing !== undefined && fermata.pointing !== "auto") ||
      fermata.id !== undefined ||
      fermata._c !== undefined)
  );
}

function durationHint(multiplier: number): Fermata["duration"] {
  if (multiplier <= 1) return "none";
  if (multiplier <= 1.25) return "veryShort";
  if (multiplier <= 1.5) return "short";
  if (multiplier <= 2) return "normal";
  if (multiplier <= 2.5) return "long";
  return "veryLong";
}

/** An export copy with notation on every projected carrier and shared identities. */
export function materializeGlobalFermatas(score: Score): Score {
  const output = structuredClone(score);
  const rows = collectScoreEventSpans(output);
  output.global.measures.forEach((measure, measureIndex) => {
    const spans = rows[measureIndex]!;
    for (const span of spans) {
      const target = carrier(span);
      if (target.fermata) {
        target.fermata._x = {
          ...target.fermata._x,
          viritura: { ...vendor(target.fermata), localOnly: true },
        };
      }
    }
    if (measure.fermatas) measure.fermatas = canonicalGlobalFermatas(measure.fermatas);
    for (const fermata of measure.fermatas ?? []) {
      const beat = (fermata.position.fraction[0] / fermata.position.fraction[1]) * 4;
      for (const span of spans.filter((s) => s.onset <= beat + 1e-9 && s.end > beat + 1e-9)) {
        const target = carrier(span);
        const local = target.fermata;
        target.fermata = {
          ...(local ?? { duration: durationHint(fermata.multiplier ?? 2) }),
          _x: {
            ...local?._x,
            viritura: { ...vendor(local), globalFermataId: fermata.id },
          },
        };
      }
    }
  });
  return output;
}

function positionAt(beat: number): GlobalFermata["position"] {
  for (let denominator = 1; denominator <= 65536; denominator++) {
    const numerator = Math.round((beat / 4) * denominator);
    if (Math.abs((numerator / denominator) * 4 - beat) < 1e-9) return { fraction: [numerator, denominator] };
  }
  throw new RangeError("Imported fermata position cannot be represented on the rhythmic grid.");
}

/** Promote strictly aligned legacy fermatas; retain intentional/non-aligned locals. */
export function mergeImportedFermatas(score: Score, diagnostics = new DiagnosticCollector()): void {
  const rows = collectScoreEventSpans(score);
  score.global.measures.forEach((measure, measureIndex) => {
    const spans = rows[measureIndex]!;
    const candidates = new Map<string, FermataEventSpan[]>();
    for (const span of spans) {
      const target = carrier(span);
      const marker = vendor(target.fermata);
      if (typeof marker?.["globalFermataId"] === "string") {
        if (!measure.fermatas?.some((f) => f.id === marker["globalFermataId"])) {
          throw new Error(`Projected fermata references missing global identity ${marker["globalFermataId"]}.`);
        }
        if (!marker["localOnly"]) delete target.fermata;
        else if (target.fermata?._x) delete marker["globalFermataId"];
      } else if (target.fermata && !marker?.["localOnly"]) {
        const key = fermataPositionKey(positionAt(span.onset));
        const group = candidates.get(key) ?? [];
        group.push(span);
        candidates.set(key, group);
      }
    }
    for (const group of candidates.values()) {
      const beat = group[0]!.onset;
      const sounding = spans.filter((s) => s.onset <= beat + 1e-9 && s.end > beat + 1e-9);
      const candidateStaves = new Set(group.map((s) => `${s.partIndex}:${s.staff}`));
      const otherStavesResting = sounding.every(
        (s) =>
          candidateStaves.has(`${s.partIndex}:${s.staff}`) || (!s.event?.notes?.length && !s.event?.kitNotes?.length),
      );
      if (candidateStaves.size > 1 || otherStavesResting) {
        const position = positionAt(beat);
        const existing = measure.fermatas?.find((f) => fermataPositionKey(f.position) === fermataPositionKey(position));
        const driver = [...group].sort((a, b) => a.duration - b.duration || a.partIndex - b.partIndex)[0]!;
        const fermata = existing ?? {
          id: generateId(),
          position,
          multiplier: fermataMultiplier(carrier(driver).fermata),
        };
        measure.fermatas = canonicalGlobalFermatas([...(measure.fermatas ?? []), fermata]);
        for (const span of group) {
          const target = carrier(span);
          if (target.fermata && hasLocalPresentation(target.fermata)) {
            target.fermata._x = { ...target.fermata._x, viritura: { ...vendor(target.fermata), localOnly: true } };
          } else {
            delete target.fermata;
          }
        }
      } else {
        for (const span of group) {
          const target = carrier(span);
          if (target.fermata) {
            target.fermata._x = { ...target.fermata._x, viritura: { ...vendor(target.fermata), localOnly: true } };
          }
          diagnostics.warn(
            ptr("parts", span.partIndex, "measures", measureIndex, "sequences", span.sequenceIndex),
            `Fermata at beat ${beat + 1} was retained as local because other sounding staves are not aligned.`,
            "unmerged-local-fermata",
          );
        }
      }
    }
  });
  for (const measure of score.global.measures) {
    if (measure.fermatas) measure.fermatas = canonicalGlobalFermatas(measure.fermatas);
  }
}
