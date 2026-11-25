// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("metronome sound preference", () => {
  it("loads the saved sound when the store is initialized", async () => {
    localStorage.setItem("viritura.metronome.sound", "woodblock");
    vi.resetModules();
    const { getMetronomeSound } = await import("./metronomeSettingsStore");
    expect(getMetronomeSound()).toBe("woodblock");
  });

  it("reports an invalid saved sound and uses the default", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("viritura.metronome.sound", "invalid");
    vi.resetModules();
    const { getMetronomeSound } = await import("./metronomeSettingsStore");
    expect(getMetronomeSound()).toBe("tick");
    expect(warning).toHaveBeenCalledOnce();
  });
});
