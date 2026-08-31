/**
 * Instrument-profiles store.
 *
 * Holds the user's machine-local VST instrument profiles and the profile-editor
 * window state. Mutations persist through the tested `@viritura/instrument-profiles`
 * store (localStorage-backed in the web/dev build; a Tauri fs adapter in Phase 3).
 * Module-level setters mirror the `themeStore` pattern so callers outside React
 * need no dep-array bookkeeping.
 */

import { create } from "zustand";
import type {
  InstrumentProfileStore,
  ProfileSlot,
  SlotBinding,
  VstInstrumentProfile,
} from "@viritura/instrument-profiles";
import { createEditorProfileStore } from "./profilePersistence";
import { createEmptyProfile, duplicateProfile } from "./slotFactory";

let persistence: InstrumentProfileStore = createEditorProfileStore();

/** Test seam: replace the persistence backend (e.g. an in-memory store). */
export function setInstrumentProfilePersistence(store: InstrumentProfileStore): void {
  persistence = store;
}

interface InstrumentProfileState {
  profiles: readonly VstInstrumentProfile[];
  loaded: boolean;
  /** The profile currently open in the editor window, or `null` when closed. */
  editingProfileId: string | null;
  _load: () => Promise<void>;
  _create: (displayName: string) => string;
  _delete: (id: string) => void;
  _duplicate: (id: string) => string | null;
  _rename: (id: string, displayName: string) => void;
  _addSlot: (profileId: string, slot: ProfileSlot) => void;
  _removeSlot: (profileId: string, slotId: string) => void;
  _renameSlot: (profileId: string, slotId: string, label: string) => void;
  _updateSlotBinding: (profileId: string, slotId: string, patch: Partial<SlotBinding>) => void;
  _openEditor: (id: string) => void;
  _closeEditor: () => void;
}

function persist(profiles: readonly VstInstrumentProfile[]): void {
  void persistence.save(profiles).catch(() => {
    // Persistence is best-effort in the web/dev build; a quota or availability
    // error must not break in-session editing.
  });
}

function mapProfile(
  profiles: readonly VstInstrumentProfile[],
  id: string,
  fn: (profile: VstInstrumentProfile) => VstInstrumentProfile,
): readonly VstInstrumentProfile[] {
  return profiles.map((profile) => (profile.id === id ? fn(profile) : profile));
}

function withSlots(profile: VstInstrumentProfile, slots: readonly ProfileSlot[]): VstInstrumentProfile {
  // Adding/removing slots is a material change to the profile's source set, so
  // bump the version (scores key their assignments to profileId + version).
  return { ...profile, version: profile.version + 1, slots };
}

export const useInstrumentProfileStore = create<InstrumentProfileState>()((set, get) => ({
  profiles: [],
  loaded: false,
  editingProfileId: null,

  async _load() {
    const { profiles } = await persistence.load();
    set({ profiles, loaded: true });
  },

  _create(displayName) {
    const profile = createEmptyProfile(displayName);
    const profiles = [...get().profiles, profile];
    set({ profiles, editingProfileId: profile.id });
    persist(profiles);
    return profile.id;
  },

  _delete(id) {
    const profiles = get().profiles.filter((profile) => profile.id !== id);
    const editingProfileId = get().editingProfileId === id ? null : get().editingProfileId;
    set({ profiles, editingProfileId });
    persist(profiles);
  },

  _duplicate(id) {
    const source = get().profiles.find((profile) => profile.id === id);
    if (!source) return null;
    const copy = duplicateProfile(source, `${source.displayName} copy`);
    const profiles = [...get().profiles, copy];
    set({ profiles });
    persist(profiles);
    return copy.id;
  },

  _rename(id, displayName) {
    const profiles = mapProfile(get().profiles, id, (profile) => ({ ...profile, displayName }));
    set({ profiles });
    persist(profiles);
  },

  _addSlot(profileId, slot) {
    const profiles = mapProfile(get().profiles, profileId, (profile) => withSlots(profile, [...profile.slots, slot]));
    set({ profiles });
    persist(profiles);
  },

  _removeSlot(profileId, slotId) {
    const profiles = mapProfile(get().profiles, profileId, (profile) =>
      withSlots(
        profile,
        profile.slots.filter((slot) => slot.slotId !== slotId),
      ),
    );
    set({ profiles });
    persist(profiles);
  },

  _renameSlot(profileId, slotId, label) {
    const profiles = mapProfile(get().profiles, profileId, (profile) => ({
      ...profile,
      slots: profile.slots.map((slot) => (slot.slotId === slotId ? { ...slot, label } : slot)),
    }));
    set({ profiles });
    persist(profiles);
  },

  _updateSlotBinding(profileId, slotId, patch) {
    const profiles = mapProfile(get().profiles, profileId, (profile) => ({
      ...profile,
      slots: profile.slots.map((slot) =>
        slot.slotId === slotId ? { ...slot, binding: { ...slot.binding, ...patch } } : slot,
      ),
    }));
    set({ profiles });
    persist(profiles);
  },

  _openEditor(id) {
    set({ editingProfileId: id });
  },

  _closeEditor() {
    set({ editingProfileId: null });
  },
}));

const store = () => useInstrumentProfileStore.getState();

export const loadInstrumentProfiles = (): Promise<void> => store()._load();
export const createInstrumentProfile = (displayName: string): string => store()._create(displayName);
export const deleteInstrumentProfile = (id: string): void => store()._delete(id);
export const duplicateInstrumentProfile = (id: string): string | null => store()._duplicate(id);
export const renameInstrumentProfile = (id: string, displayName: string): void => store()._rename(id, displayName);
export const addInstrumentProfileSlot = (profileId: string, slot: ProfileSlot): void =>
  store()._addSlot(profileId, slot);
export const removeInstrumentProfileSlot = (profileId: string, slotId: string): void =>
  store()._removeSlot(profileId, slotId);
export const renameInstrumentProfileSlot = (profileId: string, slotId: string, label: string): void =>
  store()._renameSlot(profileId, slotId, label);
export const updateInstrumentProfileSlotBinding = (
  profileId: string,
  slotId: string,
  patch: Partial<SlotBinding>,
): void => store()._updateSlotBinding(profileId, slotId, patch);
export const openProfileEditor = (id: string): void => store()._openEditor(id);
export const closeProfileEditor = (): void => store()._closeEditor();

/**
 * Persist opaque plugin-state bytes captured via edit-and-listen, returning the
 * content-addressed `stateRef` to store on the slot binding. Persistence, not the
 * host bridge, owns the state store (§1.5).
 */
export const putInstrumentProfileState = (bytes: Uint8Array): Promise<string> => persistence.putState(bytes);

/**
 * Read the opaque state bytes a binding already references, so re-opening the
 * editor restores the saved patch first and edits are incremental. Returns `null`
 * when there is no stored state or the plugin identity can't be confirmed.
 */
export const readInstrumentProfileState = async (binding: SlotBinding): Promise<Uint8Array | null> => {
  if (!binding.stateRef || !binding.pluginIdentity) return null;
  const restored = await persistence.restoreState(binding, binding.pluginIdentity);
  return restored.ok ? restored.bytes : null;
};
