import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstrumentProfileStore, VstInstrumentProfile } from "@viritura/instrument-profiles";
import {
  addInstrumentProfileSlot,
  createInstrumentProfile,
  deleteInstrumentProfile,
  duplicateInstrumentProfile,
  setInstrumentProfilePersistence,
  updateInstrumentProfileSlotBinding,
  useInstrumentProfileStore,
} from "./instrumentProfileStore";
import { createCustomSlot } from "./slotFactory";

function inMemoryPersistence(): InstrumentProfileStore & { saved: VstInstrumentProfile[][] } {
  const saved: VstInstrumentProfile[][] = [];
  return {
    saved,
    async load() {
      return { profiles: [], issues: [] };
    },
    async save(profiles) {
      saved.push([...profiles]);
    },
    async putState() {
      return "ref";
    },
    async restoreState() {
      return { ok: false, reason: "missing" };
    },
  };
}

describe("instrumentProfileStore", () => {
  let persistence: ReturnType<typeof inMemoryPersistence>;

  beforeEach(() => {
    persistence = inMemoryPersistence();
    setInstrumentProfilePersistence(persistence);
    useInstrumentProfileStore.setState({ profiles: [], editingProfileId: null, loaded: false });
  });

  it("creates a profile and opens it in the editor", () => {
    const id = createInstrumentProfile("My Orchestra");
    const { profiles, editingProfileId } = useInstrumentProfileStore.getState();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.displayName).toBe("My Orchestra");
    expect(editingProfileId).toBe(id);
  });

  it("adds a slot and bumps the profile version", () => {
    const id = createInstrumentProfile("P");
    const before = useInstrumentProfileStore.getState().profiles[0]!.version;
    addInstrumentProfileSlot(id, createCustomSlot("strings", "Nyckelharpa"));
    const after = useInstrumentProfileStore.getState().profiles[0]!;
    expect(after.slots).toHaveLength(1);
    expect(after.version).toBe(before + 1);
  });

  it("updates a slot binding in place", () => {
    const id = createInstrumentProfile("P");
    const slot = createCustomSlot("strings", "X");
    addInstrumentProfileSlot(id, slot);
    updateInstrumentProfileSlotBinding(id, slot.slotId, { luaScriptPath: "/x.lua" });
    const updated = useInstrumentProfileStore.getState().profiles[0]!.slots[0]!;
    expect(updated.binding.luaScriptPath).toBe("/x.lua");
    expect(updated.binding.baseChannel).toBe(0);
  });

  it("duplicates and deletes profiles", () => {
    const id = createInstrumentProfile("Orig");
    const copyId = duplicateInstrumentProfile(id);
    expect(copyId).not.toBeNull();
    expect(useInstrumentProfileStore.getState().profiles).toHaveLength(2);
    deleteInstrumentProfile(id);
    const remaining = useInstrumentProfileStore.getState().profiles;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(copyId);
  });

  it("persists after each mutation", async () => {
    createInstrumentProfile("P");
    await vi.waitFor(() => expect(persistence.saved.length).toBeGreaterThan(0));
  });
});
