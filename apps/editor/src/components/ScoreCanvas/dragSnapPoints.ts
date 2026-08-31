import type { SpatialIndex } from "@viritura/renderer";
import type { Score } from "@viritura/core";
import { eventSuffix } from "../../score/ElementPath";

export interface DragSnapPoint {
  x: number;
  beat: number;
  measureIndex: number;
}

const BASE_BEATS: Record<string, number> = {
  maxima: 32,
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
  "128th": 0.03125,
  "256th": 0.015625,
};

/**
 * Build snap points for the spanner drag ruler.
 * @param score - source score (from docScoreRef)
 * @param si - spatial index for x-position lookups
 * @param partIndex - which part's events to scan
 * @param fine - true for 16th-note grid, false for 8th-note grid
 */
export function buildDragSnapPoints(
  score: Score | null,
  si: SpatialIndex | null,
  partIndex: number,
  fine: boolean,
): DragSnapPoint[] {
  if (!score || !si) return [];

  const points: DragSnapPoint[] = [];
  let activeTime = { count: 4, unit: 4 };
  for (let m = 0; m < score.global.measures.length; m++) {
    const gm = score.global.measures[m];
    if (gm?.time) activeTime = gm.time;
    const beatsInMeasure = activeTime.count * (4 / activeTime.unit);

    const partMeasure = score.parts[partIndex]?.measures[m];
    if (!partMeasure) continue;

    const eventPairs = collectEventPairs(partMeasure, si, partIndex, m);
    if (eventPairs.length === 0) continue;

    // Sort and dedupe by beat
    eventPairs.sort((a, b) => a.beat - b.beat);
    const deduped: Array<{ x: number; beat: number }> = [];
    for (const ep of eventPairs) {
      if (deduped.length === 0 || Math.abs(ep.beat - deduped[deduped.length - 1]!.beat) > 0.001) {
        deduped.push(ep);
      }
    }

    const interpPairs = buildInterpPairs(deduped, beatsInMeasure);
    if (!fine) {
      // Add all event onsets
      for (const ep of deduped) {
        points.push({ x: ep.x, beat: ep.beat, measureIndex: m });
      }
      // Add quarter-note grid between events
      const seen = new Set(deduped.map((ep) => Math.round(ep.beat * 1000)));
      for (let b = 0; b < beatsInMeasure; b += 1) {
        const key = Math.round(b * 1000);
        if (seen.has(key)) continue;
        points.push({ x: interpolateX(interpPairs, b), beat: b, measureIndex: m });
      }
    } else {
      // 16th-note grid
      const quantize = 0.25;
      for (let b = 0; b <= beatsInMeasure; b += quantize) {
        points.push({ x: interpolateX(interpPairs, b), beat: b, measureIndex: m });
      }
    }
  }

  return points;
}

function collectEventPairs(
  partMeasure: Score["parts"][number]["measures"][number],
  si: SpatialIndex,
  partIndex: number,
  measureIndex: number,
): Array<{ x: number; beat: number }> {
  const eventPairs: Array<{ x: number; beat: number }> = [];
  const seq = partMeasure.sequences?.[0];
  if (!seq) return eventPairs;
  let beatPos = 0;
  for (let e = 0; e < seq.content.length; e++) {
    const ev = seq.content[e];
    if (!ev) continue;

    const evId = eventSuffix((ev as { id?: string }).id, e, measureIndex, 0);
    const elementId = `p${partIndex}/m${measureIndex}/s0/${evId}`;
    const bbox = si.getBBox(elementId);
    if (bbox) eventPairs.push({ x: bbox.x, beat: beatPos });

    if (ev.type === "event" || ev.type === "space") {
      const dur = ev.duration;
      if (dur && typeof dur === "object" && "base" in dur) {
        let beats = BASE_BEATS[(dur as { base: string }).base] ?? 1;
        if ("dots" in dur && typeof (dur as { dots?: number }).dots === "number") {
          let dotVal = beats / 2;
          for (let d = 0; d < (dur as { dots: number }).dots; d++) {
            beats += dotVal;
            dotVal /= 2;
          }
        }
        beatPos += beats;
      }
    }
  }
  return eventPairs;
}

function buildInterpPairs(
  deduped: Array<{ x: number; beat: number }>,
  beatsInMeasure: number,
): Array<{ x: number; beat: number }> {
  const interpPairs = [...deduped];
  if (interpPairs.length >= 2) {
    const last = interpPairs[interpPairs.length - 1]!;
    const prev = interpPairs[interpPairs.length - 2]!;
    const pxPerBeat = last.beat > prev.beat ? (last.x - prev.x) / (last.beat - prev.beat) : 15;
    interpPairs.push({ x: last.x + pxPerBeat * (beatsInMeasure - last.beat), beat: beatsInMeasure });
  } else if (interpPairs.length === 1) {
    interpPairs.push({ x: interpPairs[0]!.x + 80, beat: beatsInMeasure });
  }
  return interpPairs;
}

function interpolateX(interpPairs: Array<{ x: number; beat: number }>, beat: number): number {
  let lo = interpPairs[0]!;
  let hi = interpPairs[interpPairs.length - 1]!;
  for (let i = 0; i < interpPairs.length - 1; i++) {
    if (interpPairs[i]!.beat <= beat + 0.001 && interpPairs[i + 1]!.beat >= beat - 0.001) {
      lo = interpPairs[i]!;
      hi = interpPairs[i + 1]!;
      break;
    }
  }
  const range = hi.beat - lo.beat;
  const t = range > 0 ? (beat - lo.beat) / range : 0;
  return lo.x + t * (hi.x - lo.x);
}
