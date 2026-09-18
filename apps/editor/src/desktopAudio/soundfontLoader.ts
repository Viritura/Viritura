import type { SoundfontLoader } from "@viritura/playback";
import { isDesktopHost } from "../instrumentProfiles";

let bufferPromise: Promise<ArrayBuffer> | undefined;

const desktopSoundfontLoader: SoundfontLoader = {
  load() {
    // Keep one binary buffer across providers and mode switches, without copying 119 MiB.
    bufferPromise ??= import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<ArrayBuffer>("desktop_soundfont_bytes"))
      .then((buffer) => {
        if (!(buffer instanceof ArrayBuffer)) throw new Error("Expected binary SoundFont IPC response.");
        return buffer;
      })
      .catch((error: unknown) => {
        bufferPromise = undefined;
        throw error;
      });
    return bufferPromise;
  },
};

export function getDesktopSoundfontLoader(): SoundfontLoader | undefined {
  return isDesktopHost() ? desktopSoundfontLoader : undefined;
}
