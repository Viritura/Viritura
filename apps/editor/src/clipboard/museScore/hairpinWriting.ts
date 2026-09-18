import type { CapturedDynamic } from "../ClipboardFragment";
import { MuseScoreConversionError, unsupported } from "./errors";
import { ZERO, add, compare, fromTuple, subtract, type Fraction } from "./fractions";
import { connectorPairXml } from "./relativeConnectors";
import { escapeXml } from "./xml";

export interface HairpinAnnotation {
  offset: Fraction;
  xml: string;
  currentDynamic?: string;
}

export function immediateDynamicXml(value: string, velocity: number | undefined, path: string): string {
  if (velocity !== undefined && (!Number.isInteger(velocity) || velocity < 1 || velocity > 127)) {
    throw new MuseScoreConversionError("invalid-structure", "dynamic velocity must be 1..127", path);
  }
  return (
    `<Dynamic><subtype>${escapeXml(value)}</subtype>` +
    `${velocity === undefined ? "" : `<velocity>${velocity}</velocity>`}</Dynamic>`
  );
}

function hairpinEnd(captured: CapturedDynamic, offset: Fraction, path: string): Fraction {
  if (captured.endOffset) return fromTuple(captured.endOffset);
  const { dynamic } = captured;
  if (!dynamic.end) unsupported("gradual dynamic is missing its endpoint", path);
  // Measure identifiers are opaque. Only an explicit same-measure relationship
  // permits reconstructing the endpoint without the captured absolute timeline.
  if (captured.endMeasureOffset === undefined || captured.endMeasureOffset !== captured.measureOffset) {
    unsupported("cross-barline HairPin export requires captured endOffset timing", path);
  }
  return add(offset, subtract(fromTuple(dynamic.end.position.fraction), fromTuple(dynamic.position.fraction)));
}

export function hairpinAnnotations(
  captured: CapturedDynamic,
  offset: Fraction,
  staff: number,
  voice: number,
  path: string,
): HairpinAnnotation[] {
  const { dynamic } = captured;
  if (dynamic.type !== "gradual") unsupported("expected a gradual dynamic", path);
  if (dynamic.staffEnd !== undefined && dynamic.staffEnd !== (dynamic.staff ?? 1)) {
    unsupported("cross-staff HairPin endpoints are not supported by MuseScore paste", path);
  }
  for (const property of ["glyphs", "prefix", "suffix", "relativeValue", "voice"] as const) {
    if (dynamic[property] !== undefined) unsupported(`HairPin ${property} is not supported`, path);
  }
  if (dynamic.wedgeType !== "increasing" && dynamic.wedgeType !== "decreasing") {
    unsupported("HairPin requires an increasing or decreasing wedge", path);
  }
  if (dynamic.playbackVelocity !== undefined && dynamic.value === undefined) {
    unsupported("HairPin playback velocity without a written start dynamic cannot be exported", path);
  }
  const end = hairpinEnd(captured, offset, path);
  if (compare(offset, ZERO) < 0 || compare(end, offset) <= 0) {
    throw new MuseScoreConversionError(
      "invalid-timing",
      "HairPin must have a positive, selection-contained span",
      path,
    );
  }
  const connector = connectorPairXml(
    "HairPin",
    { staff, voice, time: offset, note: 0 },
    { staff, voice, time: end, note: 0 },
    `<subtype>${dynamic.wedgeType === "increasing" ? 0 : 1}</subtype>`,
  );
  const current = dynamic.value === undefined ? "" : immediateDynamicXml(dynamic.value, dynamic.playbackVelocity, path);
  return [
    { offset, xml: connector.start, ...(current ? { currentDynamic: current } : {}) },
    { offset: end, xml: connector.end },
  ];
}

export function reconcileHairpinDynamics(annotations: HairpinAnnotation[], hairpinTimes: ReadonlySet<string>): void {
  const markings = new Map<string, string>();
  for (const annotation of annotations) {
    const time = `${annotation.offset.numerator}/${annotation.offset.denominator}`;
    if (!annotation.currentDynamic || !hairpinTimes.has(time)) continue;
    const previous = markings.get(time);
    if (previous !== undefined) {
      if (previous !== annotation.currentDynamic) unsupported("conflicting coincident HairPin dynamics", "dynamics");
      delete annotation.currentDynamic;
    } else {
      markings.set(time, annotation.currentDynamic);
    }
  }
}
