import type { GlobalMeasure } from "@viritura/core";
import type { Caesura as RawCaesura } from "@viritura/core/raw";

export function parseGlobalCaesura(raw: RawCaesura | undefined): Pick<GlobalMeasure, "caesura"> {
  if (raw === undefined) return {};
  const { shape, marks, ...attributes } = raw;
  const caesura: NonNullable<GlobalMeasure["caesura"]> = { ...attributes };
  if (shape !== undefined) caesura.style = shape;
  if (marks !== undefined) caesura.marks = marks as 1 | 2;
  return { caesura };
}

export function serializeGlobalCaesura(caesura: GlobalMeasure["caesura"]): Record<string, unknown> {
  if (caesura === undefined) return {};
  const { style, ...attributes } = caesura;
  return { caesura: { ...attributes, ...(style === undefined ? {} : { shape: style }) } };
}
