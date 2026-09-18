import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackProvider } from "@viritura/playback";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { getDesktopSoundfontLoader } from "../desktopAudio";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../instrumentProfiles", () => ({ isDesktopHost: () => true }));

const buffer = new TextEncoder().encode("RIFF0000sfbk").buffer;

beforeEach(() => {
  vi.stubEnv("VITE_VIRITURA_ASSET_BASE_URL", "https://assets.viritura.com");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(toast, "warning").mockImplementation(() => 0);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PlaybackProvider SoundFont preloading", () => {
  it("uses the desktop IPC adapter even with CDN configured, including StrictMode warmup", async () => {
    vi.mocked(invoke).mockResolvedValue(buffer);
    const loader = getDesktopSoundfontLoader();
    await act(async () => {
      render(
        <StrictMode>
          <PlaybackProvider soundfontLoader={loader}>{null}</PlaybackProvider>
        </StrictMode>,
      );
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("desktop_soundfont_bytes");
    // Worklet prefetch stays app-local; there is no SF2 or CDN prefetch.
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "/sounds/spessasynth_processor.min.js")).toBe(true);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("retains a pending buffer across native/WebAudio switches instead of issuing another load", async () => {
    let resolve!: (data: ArrayBuffer) => void;
    const load = vi.fn(
      () =>
        new Promise<ArrayBuffer>((done) => {
          resolve = done;
        }),
    );
    const loader = { load };
    const view = render(
      <PlaybackProvider soundfontLoader={loader} audioRenderMode="native">
        {null}
      </PlaybackProvider>,
    );
    view.rerender(
      <PlaybackProvider soundfontLoader={loader} audioRenderMode="web">
        {null}
      </PlaybackProvider>,
    );
    await act(async () => {
      resolve(buffer);
    });
    view.rerender(
      <PlaybackProvider soundfontLoader={loader} audioRenderMode="native">
        {null}
      </PlaybackProvider>,
    );
    expect(load).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "/sounds/spessasynth_processor.min.js")).toBe(true);
  });

  it("reports local loading failure without requesting a browser fallback", async () => {
    const loader = { load: vi.fn().mockRejectedValue(new Error("Missing bundled SoundFont")) };
    await act(async () => {
      render(<PlaybackProvider soundfontLoader={loader}>{null}</PlaybackProvider>);
    });
    expect(toast.warning).toHaveBeenCalledWith("Bundled sound library failed to load", expect.any(Object));
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "/sounds/spessasynth_processor.min.js")).toBe(true);
  });

  it("keeps hosted provider prefetch on the configured CDN", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(buffer));
    await act(async () => {
      render(<PlaybackProvider>{null}</PlaybackProvider>);
    });
    expect(fetch).toHaveBeenCalledWith("https://assets.viritura.com/sounds/Shan-SGM-Pro-15.sf2");
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
