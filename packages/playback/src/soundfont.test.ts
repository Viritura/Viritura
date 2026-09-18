import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { loadSoundfont } from "./soundfont";

const sf2 = new TextEncoder().encode("RIFF0000sfbk").buffer;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => new Response(sf2)),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(toast, "warning").mockImplementation(() => 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("built-in SoundFont source", () => {
  it("uses the host buffer without copying it or consulting the configured CDN", async () => {
    vi.stubEnv("VITE_VIRITURA_ASSET_BASE_URL", "https://assets.viritura.com");
    const load = vi.fn().mockResolvedValue(sf2);
    expect(await loadSoundfont({ load })).toBe(sf2);
    expect(load).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("reports a local resource failure without downloading a fallback", async () => {
    const load = vi.fn().mockRejectedValue(new Error("Bundled resource missing"));
    expect(await loadSoundfont({ load })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(
      "Bundled sound library failed to load",
      expect.objectContaining({ description: expect.stringContaining("reinstall the desktop app") }),
    );
  });

  it.each(["", "RIFF", "RIFF0000WAVE", "<html>fallback</html>"])("rejects invalid host data: %s", async (data) => {
    expect(await loadSoundfont({ load: async () => new TextEncoder().encode(data).buffer })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledOnce();
  });

  it("keeps the configured CDN URL for hosted browser playback", async () => {
    vi.stubEnv("VITE_VIRITURA_ASSET_BASE_URL", " https://assets.viritura.com/// ");
    expect(await loadSoundfont()).toEqual(sf2);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://assets.viritura.com/sounds/Shan-SGM-Pro-15.sf2");
  });

  it("uses the app base for browser development without a CDN", async () => {
    vi.stubEnv("VITE_VIRITURA_ASSET_BASE_URL", "");
    vi.stubEnv("BASE_URL", "/editor/");
    expect(await loadSoundfont()).toEqual(sf2);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/editor/sounds/Shan-SGM-Pro-15.sf2");
  });

  it("accepts valid bytes despite an incorrect MIME type", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(sf2, { headers: { "Content-Type": "text/html" } }));
    expect(await loadSoundfont()).toEqual(sf2);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("reports an SPA fallback rather than passing HTML to the synthesizer", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("<html>fallback</html>", { headers: { "Content-Type": "text/html" } }),
    );
    expect(await loadSoundfont()).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith("Sound library not deployed at this origin", expect.any(Object));
  });

  it("reports an HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    expect(await loadSoundfont()).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith("Sound library unavailable", expect.any(Object));
  });

  it("reports a browser network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    expect(await loadSoundfont()).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith("Sound library failed to load", expect.any(Object));
  });
});
