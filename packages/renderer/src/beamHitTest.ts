import type { DisplayList, DrawPolygon } from "./wasm";

const BEAM_ID = /\/beam\d+$/;

export function isBeamElementId(elementId: string): boolean {
  return BEAM_ID.test(elementId);
}

/** Hit-test only the painted beam polygons, before broader event/stem boxes. */
export function hitTestBeamInk(
  displayList: DisplayList | null | undefined,
  x: number,
  y: number,
  tolerance = 2,
): string | null {
  if (!displayList?.elementIds) return null;
  for (let index = displayList.commands.length - 1; index >= 0; index--) {
    const id = displayList.elementIds[index];
    const command = displayList.commands[index];
    if (!id || !isBeamElementId(id) || command?.type !== "DrawPolygon") continue;
    if (pointHitsPolygon(command, x, y, tolerance)) return id;
  }
  return null;
}

function pointHitsPolygon(polygon: DrawPolygon, x: number, y: number, tolerance: number): boolean {
  if (pointInPolygon(polygon.points, x, y)) return true;
  const toleranceSquared = tolerance * tolerance;
  for (let index = 0; index < polygon.points.length; index++) {
    const start = polygon.points[index]!;
    const end = polygon.points[(index + 1) % polygon.points.length]!;
    if (distanceToSegmentSquared(x, y, start[0], start[1], end[0], end[1]) <= toleranceSquared) return true;
  }
  return false;
}

function pointInPolygon(points: readonly [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const [cx, cy] = points[current]!;
    const [px, py] = points[previous]!;
    if (cy > y !== py > y && x < ((px - cx) * (y - cy)) / (py - cy) + cx) inside = !inside;
  }
  return inside;
}

function distanceToSegmentSquared(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (px - x1) ** 2 + (py - y1) ** 2;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2;
}

/** Resolve a rendered group to its exact member event element IDs. */
export function selectionGroupMembers(displayList: DisplayList | null | undefined, elementId: string): string[] {
  return displayList?.selectionGroups?.find((group) => group.elementId === elementId)?.memberIds ?? [];
}
