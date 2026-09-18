import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isDesktopHost } from "../instrumentProfiles";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../instrumentProfiles", () => ({ isDesktopHost: vi.fn(() => true) }));

afterEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("desktop SoundFont host adapter", () => {
  it("does not inject a loader in the browser", async () => {
    vi.mocked(isDesktopHost).mockReturnValue(false);
    const { getDesktopSoundfontLoader } = await import("./index");
    expect(getDesktopSoundfontLoader()).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shares one raw binary invocation across concurrent loads and provider remounts", async () => {
    vi.mocked(isDesktopHost).mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const buffer = new TextEncoder().encode("RIFF0000sfbk").buffer;
    vi.mocked(invoke).mockResolvedValue(buffer);
    const { getDesktopSoundfontLoader } = await import("./index");
    const loader = getDesktopSoundfontLoader()!;
    const first = loader.load();
    expect(loader.load()).toBe(first);
    expect(await first).toBe(buffer);
    expect(getDesktopSoundfontLoader()).toBe(loader);
    expect(await getDesktopSoundfontLoader()!.load()).toBe(buffer);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("desktop_soundfont_bytes");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects JSON arrays rather than copying a giant serialized buffer", async () => {
    vi.mocked(isDesktopHost).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue([82, 73, 70, 70]);
    const { getDesktopSoundfontLoader } = await import("./index");
    await expect(getDesktopSoundfontLoader()!.load()).rejects.toThrow("Expected binary SoundFont IPC response");
  });

  it("propagates missing resource errors and permits a later local retry", async () => {
    vi.mocked(isDesktopHost).mockReturnValue(true);
    const buffer = new TextEncoder().encode("RIFF0000sfbk").buffer;
    vi.mocked(invoke).mockRejectedValueOnce("Bundled resource missing").mockResolvedValueOnce(buffer);
    const { getDesktopSoundfontLoader } = await import("./index");
    await expect(getDesktopSoundfontLoader()!.load()).rejects.toBe("Bundled resource missing");
    expect(await getDesktopSoundfontLoader()!.load()).toBe(buffer);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
