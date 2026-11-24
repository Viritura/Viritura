import type { Score } from "@viritura/core";
import { REVERB_PRESETS } from "@viritura/audio";
import { loadSoundfont, type SoundfontLoader } from "../soundfont";
import type {
  AudioEffects,
  AudioEncoding,
  AudioPartMix,
  AudioRenderRequest,
  AudioRenderResponse,
  AudioStage,
} from "./messages";

export {
  MP3_BITRATES,
  WAV_BIT_DEPTHS,
  type AudioEncoding,
  type AudioPartMix,
  type Mp3Bitrate,
  type WavBitDepth,
} from "./messages";

/** A snapshot of the playback stage, room, and master bus. */
export interface AudioExportSettings {
  stage: AudioStage;
  reverbPresetId: string;
  reverbWet: number;
  airEqGainDb: number;
  limiterThresholdDb: number;
  limiterRatio: number;
}

export interface AudioExportOptions {
  mix?: readonly AudioPartMix[];
  /** Playback stage and effects; omitted renders the default stage without effects. */
  settings?: AudioExportSettings;
  soundfontLoader?: SoundfontLoader;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface AudioExportResult {
  bytes: Uint8Array;
  warnings: string[];
}

function abortError(): DOMException {
  return new DOMException("Audio export cancelled.", "AbortError");
}

async function loadExportSoundfont(loader?: SoundfontLoader, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (signal?.aborted) throw abortError();
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const soundfont = await Promise.race([loadSoundfont(loader, signal), cancelled]);
    if (!soundfont) throw new Error("Cannot export audio without the sound library.");
    return soundfont;
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

async function loadImpulse(presetId: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const preset = REVERB_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset?.url) return null;
  const baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  const response = await fetch(`${baseUrl}${preset.url}`, { signal });
  if (!response.ok) throw new Error(`Could not load the ${preset.name} reverb (HTTP ${response.status}).`);
  return response.arrayBuffer();
}

async function resolveEffects(settings: AudioExportSettings, signal?: AbortSignal): Promise<AudioEffects> {
  const impulse = await loadImpulse(settings.reverbPresetId, signal);
  return {
    reverb: impulse ? { impulse, wet: settings.reverbWet } : null,
    airEqGainDb: settings.airEqGainDb,
    limiterThresholdDb: settings.limiterThresholdDb,
    limiterRatio: settings.limiterRatio,
  };
}

export async function exportScoreAudio(
  score: Score,
  encoding: AudioEncoding,
  options: AudioExportOptions = {},
): Promise<AudioExportResult> {
  const soundfont = await loadExportSoundfont(options.soundfontLoader, options.signal);
  if (options.signal?.aborted) throw abortError();
  const effects = options.settings ? await resolveEffects(options.settings, options.signal) : undefined;
  if (options.signal?.aborted) throw abortError();

  const worker = new Worker(new URL("./audioWorker.ts", import.meta.url), {
    type: "module",
    name: "viritura-audio-export",
  });
  return new Promise<AudioExportResult>((resolve, reject) => {
    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(abortError());
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", ({ data }: MessageEvent<AudioRenderResponse>) => {
      if (data.type === "progress") {
        options.onProgress?.(data.fraction);
      } else if (data.type === "complete") {
        cleanup();
        resolve({ bytes: new Uint8Array(data.bytes), warnings: data.warnings });
      } else {
        fail(new Error(data.message));
      }
    });
    worker.addEventListener("error", (event) => fail(new Error(event.message || "Audio export worker failed.")));
    worker.addEventListener("messageerror", () => fail(new Error("Audio export worker returned an invalid message.")));
    try {
      const copy = soundfont.slice(0);
      const request: AudioRenderRequest = {
        score,
        soundfont: copy,
        encoding,
        mix: options.mix,
        stage: options.settings?.stage,
        effects,
      };
      const transfer = effects?.reverb ? [copy, effects.reverb.impulse] : [copy];
      worker.postMessage(request, transfer);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
