import type { PaginationDiagnostics } from "./store";

export function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : "n/a";
}

export function boundaryDescription(system: PaginationDiagnostics["systems"][number]): string {
  const b = system.boundary;
  if (!b) return "No following measure or no single-part rest analysis";
  return [
    `${b.tailSeconds.toFixed(1)}s before + ${b.headSeconds.toFixed(1)}s after = ${(b.tailSeconds + b.headSeconds).toFixed(1)}s (${b.quality})`,
    ...(b.structural ? ["repeat / ending / jump hazard"] : []),
    ...(b.fermataBlocked ? ["fermata / breath / caesura in adjacent measures"] : []),
    ...(b.headRestMeasures ? [`next page would open with ${b.headRestMeasures} rest bars`] : []),
  ].join("; ");
}
