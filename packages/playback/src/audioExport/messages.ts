import type { Score } from "@viritura/core";
import type { SpatialPosition } from "@viritura/audio";

export interface AudioPartMix {
  /** Linear channel gain, including group and master faders. */
  volume: number;
  pan: number;
  muted: boolean;
  ensembleEnabled: boolean;
  /** Stage depth attenuation; omitted means on, as in playback. */
  stageDepthEnabled?: boolean;
}

/** Stage seating as playback currently uses it, indexed by playback part. */
export interface AudioStage {
  listener: SpatialPosition;
  /** Saved seat per part, or null for the part's default seat. */
  positions: readonly (SpatialPosition | null)[];
  /** Saved pan per ensemble layer, or null for the layer's default pan. */
  layerPans: readonly (readonly (number | null)[] | null)[];
}

/** Master bus settings matching the playback mixer. */
export interface AudioEffects {
  /** Impulse response WAV for the room, or null when reverb is off. */
  reverb: { impulse: ArrayBuffer; wet: number } | null;
  airEqGainDb: number;
  limiterThresholdDb: number;
  limiterRatio: number;
}

export const MP3_BITRATES = [128, 192, 256, 320] as const;
export const WAV_BIT_DEPTHS = [16, 24, 32] as const;

export type Mp3Bitrate = (typeof MP3_BITRATES)[number];
/** 16- and 24-bit are integer PCM; 32-bit is IEEE floating point. */
export type WavBitDepth = (typeof WAV_BIT_DEPTHS)[number];

export interface Mp3Encoding {
  format: "mp3";
  bitrate: Mp3Bitrate;
}

export interface WavEncoding {
  format: "wav";
  bitDepth: WavBitDepth;
}

export type AudioEncoding = Mp3Encoding | WavEncoding;

export interface AudioRenderRequest {
  score: Score;
  soundfont: ArrayBuffer;
  encoding: AudioEncoding;
  mix?: readonly AudioPartMix[];
  stage?: AudioStage;
  effects?: AudioEffects;
}

export type AudioRenderResponse =
  | { type: "progress"; fraction: number }
  | { type: "complete"; bytes: ArrayBuffer; warnings: string[] }
  | { type: "error"; message: string };
