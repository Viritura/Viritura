import type { GlobalMeasure } from "@viritura/core";
import type { Caesura as RawCaesura, MeasureGlobal as RawMeasureGlobal } from "@viritura/core/raw";

export function parseGlobalCaesura(raw: RawCaesura | undefined): Pick<GlobalMeasure, "caesura"> {
  if (raw === undefined) return {};
  const { shape, marks, ...attributes } = raw;
  const caesura: NonNullable<GlobalMeasure["caesura"]> = { ...attributes };
  if (shape !== undefined) caesura.style = shape;
  if (marks !== undefined) {
    if (marks !== 1 && marks !== 2) throw new Error("Global caesura marks must be 1 or 2");
    caesura.marks = marks;
  }
  return { caesura };
}

export function serializeGlobalCaesura(caesura: GlobalMeasure["caesura"]): Pick<RawMeasureGlobal, "caesura"> {
  if (caesura === undefined) return {};
  const { style, ...attributes } = caesura;
  return { caesura: { ...attributes, ...(style === undefined ? {} : { shape: style }) } };
}
