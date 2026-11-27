// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Each case re-imports a fresh store; transform the module graph once so a cold
// transform under a loaded parallel run cannot exceed the per-test timeout.
beforeAll(async () => {
  await import("./metronomeSettingsStore");
}, 60_000);

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("metronome sound preference", () => {
  it.each(["tick", "woodblock", "oscillator"])(
    "loads the saved %s sound when the store is initialized",
    async (sound) => {
      localStorage.setItem("viritura.metronome.sound", sound);
      vi.resetModules();
      const { getMetronomeSound } = await import("./metronomeSettingsStore");
      expect(getMetronomeSound()).toBe(sound);
    },
  );

  it("uses oscillator when no sound is saved", async () => {
    localStorage.removeItem("viritura.metronome.sound");
    vi.resetModules();
    const { getMetronomeSound } = await import("./metronomeSettingsStore");
    expect(getMetronomeSound()).toBe("oscillator");
  });

  it("migrates the removed beep preference to oscillator", async () => {
    localStorage.setItem("viritura.metronome.sound", "beep");
    vi.resetModules();
    const { getMetronomeSound } = await import("./metronomeSettingsStore");
    expect(getMetronomeSound()).toBe("oscillator");
    expect(localStorage.getItem("viritura.metronome.sound")).toBe("oscillator");
  });

  it("reports an invalid saved sound and uses the default", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("viritura.metronome.sound", "invalid");
    vi.resetModules();
    const { getMetronomeSound } = await import("./metronomeSettingsStore");
    expect(getMetronomeSound()).toBe("oscillator");
    expect(warning).toHaveBeenCalledOnce();
  });
});
