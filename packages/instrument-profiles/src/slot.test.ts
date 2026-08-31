import { describe, expect, it } from "vitest";
import { canRestoreState, isSlotFullyConfigured, slotAvailability } from "./slot";
import type { PluginIdentity, ProfileSlot, SlotBinding } from "./types";

const fullBinding: SlotBinding = {
  baseChannel: 0,
  luaScriptPath: "/a.lua",
  pluginPath: "/a.vst3",
  stateRef: "hash",
};

function slot(binding: SlotBinding): ProfileSlot {
  return { slotId: "s", section: "strings", label: "S", binding };
}

describe("isSlotFullyConfigured", () => {
  it("requires lua, plugin, and state", () => {
    expect(isSlotFullyConfigured(fullBinding)).toBe(true);
    expect(isSlotFullyConfigured({ baseChannel: 0 })).toBe(false);
    expect(isSlotFullyConfigured({ ...fullBinding, stateRef: "" })).toBe(false);
    expect(isSlotFullyConfigured({ ...fullBinding, luaScriptPath: undefined })).toBe(false);
  });
});

describe("slotAvailability", () => {
  it("is unavailable on web regardless of configuration", () => {
    expect(slotAvailability(slot(fullBinding), "web")).toEqual({
      available: false,
      reason: "web-unsupported",
    });
  });

  it("is available on desktop when fully configured", () => {
    expect(slotAvailability(slot(fullBinding), "desktop")).toEqual({ available: true, reason: "ok" });
  });

  it("is unconfigured on desktop when a value is missing", () => {
    expect(slotAvailability(slot({ baseChannel: 0 }), "desktop")).toEqual({
      available: false,
      reason: "unconfigured",
    });
  });
});

describe("canRestoreState", () => {
  const captured: PluginIdentity = {
    format: "vst3",
    pluginId: "class-abc",
    buildId: "build-1",
  };

  it("allows restore when identity matches", () => {
    expect(canRestoreState({ ...fullBinding, pluginIdentity: captured }, captured)).toBe(true);
  });

  it("refuses when no identity was captured", () => {
    expect(canRestoreState(fullBinding, captured)).toBe(false);
  });

  it("refuses on a different plugin class id", () => {
    const loaded: PluginIdentity = { format: "vst3", pluginId: "class-xyz", buildId: "build-1" };
    expect(canRestoreState({ ...fullBinding, pluginIdentity: captured }, loaded)).toBe(false);
  });

  it("refuses on a build mismatch when both expose one", () => {
    const loaded: PluginIdentity = { format: "vst3", pluginId: "class-abc", buildId: "build-2" };
    expect(canRestoreState({ ...fullBinding, pluginIdentity: captured }, loaded)).toBe(false);
  });

  it("allows when a build stamp is unknown on either side", () => {
    const capturedNoBuild: PluginIdentity = { format: "vst3", pluginId: "class-abc" };
    const loaded: PluginIdentity = { format: "vst3", pluginId: "class-abc", buildId: "build-2" };
    expect(canRestoreState({ ...fullBinding, pluginIdentity: capturedNoBuild }, loaded)).toBe(true);
  });
});
