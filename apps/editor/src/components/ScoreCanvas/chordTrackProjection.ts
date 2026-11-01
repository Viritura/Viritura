import { SpatialIndex, type DisplayList } from "@viritura/renderer";

const projectedLists = new WeakMap<DisplayList, DisplayList>();
const projectedIndices = new WeakMap<SpatialIndex, SpatialIndex>();

function isChord(id: string | null | undefined): boolean {
  return id !== undefined && id !== null && /^m\d+\/chord\d+(?:\/|$)/.test(id);
}

/** Editor-only ink projection. The retained engine score and printed layouts stay unchanged. */
export function withoutStaffChordInk(displayList: DisplayList): DisplayList {
  const cached = projectedLists.get(displayList);
  if (cached) return cached;
  const retained = displayList.commands.flatMap((command, index) =>
    isChord(displayList.elementIds?.[index]) ? [] : [{ command, id: displayList.elementIds?.[index] ?? null }],
  );
  const projected: DisplayList = {
    ...displayList,
    commands: retained.map((entry) => entry.command),
    elementIds: retained.map((entry) => entry.id),
    elementBboxes: displayList.elementBboxes?.filter((entry) => !isChord(entry.elementId)),
    retainedRenderLayers: undefined,
    finalizeRetainedFrame: undefined,
  };
  projectedLists.set(displayList, projected);
  return projected;
}

export function withoutStaffChordHits(index: SpatialIndex | null): SpatialIndex | null {
  if (!index) return null;
  const cached = projectedIndices.get(index);
  if (cached) return cached;
  const projected = new SpatialIndex(index.all.filter((entry) => !isChord(entry.id)));
  projectedIndices.set(index, projected);
  return projected;
}
