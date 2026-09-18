import { toast } from "sonner";

/** Optional host-owned source for the built-in SoundFont, independent of audio render mode. */
export interface SoundfontLoader {
  /** Return the reusable SF2 buffer without transferring or detaching it. Reject on failure. */
  load(): Promise<ArrayBuffer>;
}

function isSoundfont(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const header = new Uint8Array(buffer, 0, 12);
  return (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x73 &&
    header[9] === 0x66 &&
    header[10] === 0x62 &&
    header[11] === 0x6b
  );
}

async function loadHostSoundfont(loader: SoundfontLoader): Promise<ArrayBuffer | null> {
  try {
    const buffer = await loader.load();
    if (!isSoundfont(buffer)) throw new Error("The bundled file is not a RIFF/sfbk SoundFont.");
    return buffer;
  } catch (error) {
    console.warn("[Audio] Bundled SoundFont failed to load:", error);
    toast.warning("Bundled sound library failed to load", {
      description: "Playback will be silent. Restore the bundled SoundFont or reinstall the desktop app.",
    });
    return null;
  }
}

export async function loadSoundfont(loader?: SoundfontLoader): Promise<ArrayBuffer | null> {
  // A host source is authoritative, including failures: never fall through to a network download.
  if (loader) return loadHostSoundfont(loader);

  const env = import.meta.env;
  const configuredAssetBaseUrl = env?.VITE_VIRITURA_ASSET_BASE_URL?.trim();
  const baseUrl = configuredAssetBaseUrl ? `${configuredAssetBaseUrl.replace(/\/+$/, "")}/` : (env?.BASE_URL ?? "/");
  const sf2Url = `${baseUrl}sounds/Shan-SGM-Pro-15.sf2`;
  try {
    const response = await fetch(sf2Url);
    if (!response.ok) {
      console.warn("SF2 SoundFont not available — playback will be silent");
      toast.warning("Sound library unavailable", {
        description: `Couldn't load SoundFont (${response.status}). Playback will be silent until ${sf2Url} is reachable.`,
      });
      return null;
    }
    // SPA fallbacks can return HTML with status 200, and valid SF2 can have the wrong MIME type.
    const buffer = await response.arrayBuffer();
    if (!isSoundfont(buffer)) {
      if (response.headers.get("Content-Type")?.startsWith("text/html")) {
        console.warn(`[Audio] ${sf2Url} returned an HTML page instead of the SoundFont.`);
        toast.warning("Sound library not deployed at this origin", {
          description: `${sf2Url} returned HTML. Playback will be silent until the SoundFont is served from this origin.`,
        });
      } else {
        console.warn("[Audio] SF2 fetch returned an invalid RIFF/sfbk payload");
        toast.warning("Sound library data is invalid", {
          description: `The file at ${sf2Url} is not a valid SoundFont. Playback will be silent.`,
        });
      }
      return null;
    }
    return buffer;
  } catch (error) {
    console.warn("[Audio] SF2 fetch failed:", error);
    toast.warning("Sound library failed to load", {
      description: `Playback will be silent. Check your network connection or that ${sf2Url} is deployed.`,
    });
    return null;
  }
}
