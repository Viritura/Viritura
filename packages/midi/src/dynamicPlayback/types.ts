import type { DynamicsEnvelope } from "../dynamicsEnvelope";

/** Stable identity for one independently controlled playback stream. */
export type PlaybackLaneId = string;

export interface PlaybackLane {
  id: PlaybackLaneId;
  partIndex: number;
  staff: number;
  voice: string;
  envelope: DynamicsEnvelope;
}

export interface DynamicPlaybackDiagnostic {
  code: "missing-voice" | "scope-conflict" | "overlapping-gradual";
  message: string;
  groupIds: readonly string[];
}

export interface DynamicProgram {
  lanes: ReadonlyMap<PlaybackLaneId, PlaybackLane>;
  diagnostics: readonly DynamicPlaybackDiagnostic[];
  scoped: boolean;
}

export type DynamicResponseProfile = "sustained-expressive" | "struck-plucked" | "organ-fixed-attack" | "fallback";
