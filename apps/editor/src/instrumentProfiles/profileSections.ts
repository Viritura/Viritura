import type { OrchestraSection } from "@viritura/instrument-profiles";
import { INSTRUMENT_CATALOG, type CatalogInstrument, type InstrumentFamily } from "../score/InstrumentCatalog";

/**
 * The five sections the VST profile editor presents, in the user's requested
 * order. `voices`/`other` exist in the type but are hidden in v1's editor.
 */
export const PROFILE_EDITOR_SECTIONS: readonly OrchestraSection[] = [
  "woodwinds",
  "brass",
  "percussion",
  "keys",
  "strings",
];

export const PROFILE_SECTION_LABELS: Readonly<Record<OrchestraSection, string>> = {
  woodwinds: "Winds",
  brass: "Brass",
  percussion: "Percussion",
  keys: "Keys",
  strings: "Strings",
  voices: "Voices",
  other: "Other",
};

/**
 * Maps a catalog instrument family to the profile-editor section it lists under.
 * Keyboards fold into Keys; plucked strings (harp, guitar, bass) fold into
 * Strings so the five visible sections cover the whole catalog.
 */
const FAMILY_TO_SECTION: Readonly<Record<InstrumentFamily, OrchestraSection>> = {
  woodwinds: "woodwinds",
  brass: "brass",
  percussion: "percussion",
  keyboards: "keys",
  plucked: "strings",
  strings: "strings",
  voices: "voices",
};

export function sectionForFamily(family: InstrumentFamily): OrchestraSection {
  return FAMILY_TO_SECTION[family];
}

/** Catalog instruments belonging to a profile-editor section, in score order. */
export function catalogInstrumentsForSection(section: OrchestraSection): readonly CatalogInstrument[] {
  return INSTRUMENT_CATALOG.filter((instrument) => sectionForFamily(instrument.family) === section).sort(
    (a, b) => a.scoreOrder - b.scoreOrder,
  );
}

/**
 * Canonical orchestra position for each catalog instrument id. `INSTRUMENT_CATALOG`
 * is authored in full score order (winds → brass → percussion → keys → strings),
 * so an instrument's array index is its orchestra rank.
 */
const CATALOG_ORDER_BY_ID: ReadonlyMap<string, number> = new Map(
  INSTRUMENT_CATALOG.map((instrument, index) => [instrument.id, index]),
);

function slotOrchestraRank(catalogInstrumentId: string | undefined): number {
  if (!catalogInstrumentId) return Number.POSITIVE_INFINITY;
  return CATALOG_ORDER_BY_ID.get(catalogInstrumentId) ?? Number.POSITIVE_INFINITY;
}

/**
 * Sort profile slots into standard orchestra order using each slot's catalog
 * instrument, regardless of the order they were added. Slots without a catalog
 * instrument id sort last, preserving their relative insertion order.
 */
export function orderSlotsByScoreOrder<T extends { readonly catalogInstrumentId?: string }>(
  slots: readonly T[],
): readonly T[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort(
      (a, b) =>
        slotOrchestraRank(a.slot.catalogInstrumentId) - slotOrchestraRank(b.slot.catalogInstrumentId) ||
        a.index - b.index,
    )
    .map((entry) => entry.slot);
}
