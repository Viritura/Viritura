import { describe, expect, it } from "vitest";
import type { Part } from "@viritura/core";
import {
  createSoundProfileRegistry,
  virituraSoundsProfile,
  VIRITURA_SOUNDS_PROFILE_ID,
  type SoundProfile,
} from "@viritura/sound-profiles";
import { resolveSoundProfilePickerView } from "./soundProfilePickerView";

const vstProfile: SoundProfile = {
  id: "user-1",
  version: 1,
  displayName: "My Orchestra",
  defaultListenerPosition: { x: 0, y: 0 },
  resolve: () => null,
  sourceCatalog: () => [
    { sourceId: "vln-slot", section: "strings", label: "Custom Violin", configured: true },
    { sourceId: "cello-slot", section: "strings", label: "Custom Cello", configured: false },
  ],
};

describe("resolveSoundProfilePickerView", () => {
  it("presents registered packs with a reset choice and orchestra-ordered sections", () => {
    const part: Part = {
      id: "clarinet-1",
      name: "Clarinet",
      measures: [],
      _x: { viritura: { instrumentId: "bflat-clarinet" } },
    };

    const view = resolveSoundProfilePickerView(part, "Clarinet in B♭ 1");

    expect(view).toMatchObject({
      profileId: VIRITURA_SOUNDS_PROFILE_ID,
      profileVersion: 1,
      selectedSourceId: "",
      selectedLabel: "VirituraSounds — Notation default: B-flat Clarinet",
    });
    expect(view.packs).toHaveLength(1);
    expect(view.packs[0]).toMatchObject({
      id: VIRITURA_SOUNDS_PROFILE_ID,
      label: "VirituraSounds",
      notationDefault: {
        id: "",
        label: "Notation default: B-flat Clarinet",
      },
    });
    expect(view.packs[0]!.sections.map((section) => section.label)).toEqual([
      "Winds",
      "Brass",
      "Percussion",
      "Keys",
      "Strings",
      "Voices",
      "Other",
    ]);
    expect(view.packs[0]!.sections[1]!.options).toContainEqual({ id: "tuba-primary", label: "Tuba" });
  });

  it("uses the part display name when a legacy default has no selectable source label", () => {
    const part: Part = {
      id: "legacy-part",
      name: "Theremin",
      measures: [],
    };

    const view = resolveSoundProfilePickerView(part, "Theremin");

    expect(view.selectedLabel).toBe("VirituraSounds — Notation default: Theremin");
    expect(view.packs[0]!.notationDefault.label).toBe("Notation default: Theremin");
  });

  it("presents a user VST profile as an additional selectable pack", () => {
    const part: Part = { id: "vln-1", name: "Violin", measures: [], _x: { viritura: { instrumentId: "violin" } } };
    const registry = createSoundProfileRegistry([virituraSoundsProfile, vstProfile]);

    const view = resolveSoundProfilePickerView(part, "Violin 1", undefined, registry);

    const vstPack = view.packs.find((pack) => pack.profileId === "user-1");
    expect(vstPack).toBeDefined();
    expect(vstPack!.label).toBe("My Orchestra");
    expect(vstPack!.notationDefault).toEqual({ id: "", label: "Notation default (VirituraSounds)" });
    const strings = vstPack!.sections.find((section) => section.id === "strings");
    expect(strings!.options).toEqual([
      { id: "vln-slot", label: "Custom Violin" },
      { id: "cello-slot", label: "Custom Cello (needs setup)" },
    ]);
  });

  it("labels the trigger with the assigned VST slot", () => {
    const part: Part = { id: "vln-1", name: "Violin", measures: [], _x: { viritura: { instrumentId: "violin" } } };
    const registry = createSoundProfileRegistry([virituraSoundsProfile, vstProfile]);

    const view = resolveSoundProfilePickerView(
      part,
      "Violin 1",
      { profileId: "user-1", profileVersion: 1, parts: { "vln-1": { sourceId: "vln-slot" } } },
      registry,
    );

    expect(view.selectedSourceId).toBe("vln-slot");
    expect(view.selectedLabel).toBe("My Orchestra — Custom Violin");
    expect(view.profileId).toBe("user-1");
  });
});
