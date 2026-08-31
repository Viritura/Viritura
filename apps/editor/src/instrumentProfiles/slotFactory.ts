import type { OrchestraSection, ProfileSlot, VstInstrumentProfile } from "@viritura/instrument-profiles";
import type { CatalogInstrument } from "../score/InstrumentCatalog";

function uuid(): string {
  return crypto.randomUUID();
}

export function createEmptyProfile(displayName: string): VstInstrumentProfile {
  return { id: `user-${uuid()}`, version: 1, displayName, slots: [] };
}

/**
 * Auto-number a new slot's label from a base name, so adding "Violin" twice
 * yields "Violin 1" and "Violin 2". Counts existing labels that share the base.
 */
export function autoLabel(slots: readonly ProfileSlot[], baseName: string): string {
  const prefix = `${baseName} `;
  let max = 0;
  for (const slot of slots) {
    if (slot.label === baseName) max = Math.max(max, 1);
    if (slot.label.startsWith(prefix)) {
      const suffix = Number.parseInt(slot.label.slice(prefix.length), 10);
      if (Number.isInteger(suffix)) max = Math.max(max, suffix);
    }
  }
  return `${baseName} ${max + 1}`;
}

/** A new slot seeded from a catalog instrument (name, section, defaults). */
export function createSlotFromCatalog(
  slots: readonly ProfileSlot[],
  section: OrchestraSection,
  instrument: CatalogInstrument,
): ProfileSlot {
  return {
    slotId: `slot-${uuid()}`,
    catalogInstrumentId: instrument.id,
    section,
    label: autoLabel(slots, instrument.name),
    binding: { baseChannel: 0 },
  };
}

/** A new fully-custom slot (no catalog identity). */
export function createCustomSlot(section: OrchestraSection, label: string): ProfileSlot {
  return {
    slotId: `slot-${uuid()}`,
    section,
    label,
    binding: { baseChannel: 0 },
  };
}

/** Copy a profile under a new id/name, keeping all slot bindings. */
export function duplicateProfile(source: VstInstrumentProfile, displayName: string): VstInstrumentProfile {
  return {
    id: `user-${uuid()}`,
    version: 1,
    displayName,
    slots: source.slots.map((slot) => ({ ...slot, binding: { ...slot.binding } })),
  };
}
