import { useMemo } from "react";
import { CascadingMenu, type CascadingMenuItem } from "@viritura/ui";
import type { OrchestraSection, ProfileSlot } from "@viritura/instrument-profiles";
import { catalogInstrumentsForSection } from "./profileSections";
import { autoLabel, createCustomSlot, createSlotFromCatalog } from "./slotFactory";

interface AddInstrumentMenuProps {
  section: OrchestraSection;
  slots: readonly ProfileSlot[];
  onAddSlot: (slot: ProfileSlot) => void;
}

/**
 * "Add new Instrument" dropdown for one section: the section's predefined catalog
 * instruments (same identities VirituraSounds uses) plus "Custom instrument"
 * for obscure ones. The same catalog instrument may be added repeatedly to make
 * distinct slots (Violin 1, Violin 2, …).
 *
 * A custom instrument is created immediately under an auto-numbered name and
 * selected, so it is renamed in the inspector like every other slot. Asking for
 * the name up front took a `window.prompt`, and it was the only place in the
 * editor where naming happened before the thing existed.
 */
export function AddInstrumentMenu({ section, slots, onAddSlot }: AddInstrumentMenuProps) {
  const items = useMemo<CascadingMenuItem[]>(() => {
    const catalog: CascadingMenuItem[] = catalogInstrumentsForSection(section).map((instrument) => ({
      id: instrument.id,
      label: instrument.name,
      onSelect: () => onAddSlot(createSlotFromCatalog(slots, section, instrument)),
    }));
    const custom: CascadingMenuItem = {
      id: "custom",
      label: "Custom instrument",
      onSelect: () => onAddSlot(createCustomSlot(section, autoLabel(slots, "Custom"))),
    };
    return [...catalog, { id: "separator", separator: true }, custom];
  }, [section, slots, onAddSlot]);

  return <CascadingMenu ariaLabel="Add new instrument" label="+ Add new" items={items} triggerFullWidth={false} />;
}
