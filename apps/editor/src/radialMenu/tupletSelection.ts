import type { EventLocation, TupletSelectionLocation } from "../score/ElementPath";

export { resolveTupletSelectionLocation } from "../score/ElementPath";

export function firstTupletEventLocation(location: TupletSelectionLocation): EventLocation {
  return { ...location, eventIndex: 0 };
}
