import type { Part } from "@viritura/core";
import { INSTRUMENT_CATALOG } from "../../../score/InstrumentCatalog";
import type { FAMILY_COLORS } from "../styles";

/** Best-effort family lookup so we can render the colored family dot
 *  next to a part. */
export function familyForPart(part: Part): keyof typeof FAMILY_COLORS {
  const byName = INSTRUMENT_CATALOG.find((i) => i.name.toLowerCase() === part.name.toLowerCase());
  if (byName) return byName.family;
  if (part.shortName) {
    const byShort = INSTRUMENT_CATALOG.find((i) => i.shortName.toLowerCase() === part.shortName!.toLowerCase());
    if (byShort) return byShort.family;
  }
  return "strings";
}
