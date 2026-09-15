import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "viritura.debugSettings";

describe("debugSettingsStore hitbox configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("does not activate hitboxes from the legacy query parameter", async () => {
    window.history.replaceState({}, "", "/?hitbox=1");

    const { useDebugSettingsStore } = await import("./debugSettingsStore");

    expect(useDebugSettingsStore.getState().hitboxOverlay).toBe(false);
  });

  it("restores hitbox visibility from persisted settings", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ hitboxOverlay: true }));

    const { useDebugSettingsStore } = await import("./debugSettingsStore");

    expect(useDebugSettingsStore.getState().hitboxOverlay).toBe(true);
  });

  it("persists changes made through the settings action", async () => {
    const { useDebugSettingsStore } = await import("./debugSettingsStore");

    useDebugSettingsStore.getState().setHitboxOverlay(true);

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({ hitboxOverlay: true });
  });
});
