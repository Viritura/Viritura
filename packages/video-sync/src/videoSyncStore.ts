/**
 * Video-sync store.
 *
 * Mirrors the pattern `@viritura/playback` uses: a module-level zustand store
 * holding read-only state plus an action object the provider installs once it
 * owns a real media element. Consumers (the panel, the transport, Storybook)
 * read through hooks and never touch the synchronizer directly.
 *
 * Fallback actions keep the UI mountable with no provider present, which is what
 * makes the panel renderable in Storybook without an audio engine or a video
 * file.
 */

import { create } from "zustand";
import type { DemoVideoSource } from "./demoSources";
import type { DetectedMediaMetadata } from "./mediaMetadata";
import { DEFAULT_FRAME_RATE_ID } from "./smpte";
import type { TimelineWaveform } from "./timelineTypes";
import type { HitPoint, VideoAttachmentStatus, VideoSyncHealth } from "./types";

/** Read-only video-sync state. */
export interface VideoSyncState {
  /** Lifecycle of the attached media. */
  readonly attachment: VideoAttachmentStatus;
  /** How closely the picture is tracking the transport. */
  readonly health: VideoSyncHealth;
  /** Display name of the attached (or remembered) picture. */
  readonly mediaName: string | null;
  /** Media duration in seconds, once metadata has loaded. */
  readonly mediaDurationSeconds: number | null;
  /**
   * Object URL of the attached clip.
   *
   * Exposed so the filmstrip can open its own decoder on the same bytes. It is
   * a handle to memory this session already holds, not a path, so nothing about
   * the user's filesystem escapes through it.
   */
  readonly mediaObjectUrl: string | null;
  /** Media time (seconds) at score time zero. */
  readonly pictureOffsetSeconds: number;
  /** Whether the picture's production audio is audible. */
  readonly pictureAudioEnabled: boolean;
  /** Whether the pop-out picture window is open. */
  readonly pictureWindowOpen: boolean;
  /** Whether streamers and punches are drawn over the picture. */
  readonly showStreamers: boolean;
  /** Current media time, for the timecode readout. */
  readonly currentMediaTime: number;
  /**
   * Fraction of a demo clip downloaded so far, `null` when nothing is
   * downloading or the host declares no length. A demo is fetched whole before
   * it plays, and 16 MB of silence looks like a hang without this.
   */
  readonly downloadProgress: number | null;
  /** Display-only offset applied to the picture timecode readout. */
  readonly startTimecodeSeconds: number;
  /** Declared frame rate of the delivery. See `smpte.ts` for why it is an id. */
  readonly frameRateId: string;
  /** How the effective frame rate entered this session. */
  readonly frameRateSource: "default" | "saved" | "detected" | "manual";
  /** How the effective timecode origin entered this session. */
  readonly timecodeOriginSource: "default" | "saved" | "detected" | "manual";
  /** Metadata read directly from the selected file. */
  readonly mediaMetadata: DetectedMediaMetadata | null;
  /** Lifecycle of the lazy MediaInfo analysis. */
  readonly mediaMetadataStatus: "idle" | "loading" | "ready" | "error";
  /** Metadata-only failure; never prevents the picture itself from playing. */
  readonly mediaMetadataError: string | null;
  /** Human-readable failure, shown inline. */
  readonly errorMessage: string | null;
  /** Spotted moments in the picture, sorted by time. */
  readonly hitPoints: readonly HitPoint[];
  /**
   * Picture-audio envelope, once decoded.
   *
   * Kept in the store rather than recomputed by the timeline because decoding
   * costs a second or two and the composer switches activities constantly.
   */
  readonly waveform: TimelineWaveform | null;
  /** Whether the envelope is still being built, and whether it can be. */
  readonly waveformStatus: "idle" | "loading" | "ready" | "unavailable";
  /**
   * True when the user relinked a file whose content hash differs from the one
   * the score remembers — i.e. probably a different cut, on which every sync
   * point would be wrong.
   */
  readonly identityMismatch: boolean;
  /** Required credit line when the picture came from the demo catalog. */
  readonly attribution: string | null;
  /** Link backing the credit line. */
  readonly attributionUrl: string | null;
}

/** Actions for controlling video sync. */
export interface VideoSyncActions {
  /** Attach a user-picked file. */
  attachFile(file: File): Promise<void>;
  /** Attach a clip from the demo catalog by streaming it. */
  attachDemo(source: DemoVideoSource): Promise<void>;
  /** Detach the picture and forget it in the score. */
  removeMedia(): void;
  /** Set the media time that corresponds to score time zero. */
  setPictureOffset(seconds: number): void;
  /** Set the display-only start timecode of the delivery. */
  setStartTimecode(seconds: number): void;
  /** Declare the delivery's frame rate. */
  setFrameRate(id: string): void;
  /** Mute/unmute the picture's production audio. */
  setPictureAudioEnabled(enabled: boolean): void;
  /** Open or close the pop-out picture window. */
  togglePictureWindow(): void;
  /** Show or hide streamers and punches over the picture. */
  setShowStreamers(show: boolean): void;
  /** Hard re-anchor the picture to the playhead. */
  resync(): void;
  /** Set the offset so the current frame lands on the current playhead position. */
  alignToPlayhead(): void;

  // ── Spotting ────────────────────────────────────────────────────────────
  /** Mark a moment in the picture. Returns the new hit's id. */
  addHitPoint(pictureSeconds: number, label?: string): string;
  /** Move a hit to a different frame. */
  moveHitPoint(id: string, pictureSeconds: number): void;
  /** Rename a hit. */
  labelHitPoint(id: string, label: string): void;
  /** Whether the solver must land a downbeat on this hit. */
  setHitPointLocked(id: string, locked: boolean): void;
  removeHitPoint(id: string): void;
}

function initialState(): VideoSyncState {
  return {
    attachment: "empty",
    health: "idle",
    mediaName: null,
    mediaDurationSeconds: null,
    mediaObjectUrl: null,
    pictureOffsetSeconds: 0,
    pictureAudioEnabled: false,
    pictureWindowOpen: false,
    showStreamers: true,
    currentMediaTime: 0,
    downloadProgress: null,
    startTimecodeSeconds: 0,
    frameRateId: DEFAULT_FRAME_RATE_ID,
    frameRateSource: "default",
    timecodeOriginSource: "default",
    mediaMetadata: null,
    mediaMetadataStatus: "idle",
    mediaMetadataError: null,
    errorMessage: null,
    hitPoints: [],
    waveform: null,
    waveformStatus: "idle",
    identityMismatch: false,
    attribution: null,
    attributionUrl: null,
  };
}

const noop = () => {};
const noopAsync = async () => {};

const FALLBACK_ACTIONS: VideoSyncActions = {
  attachFile: noopAsync,
  attachDemo: noopAsync,
  removeMedia: noop,
  setPictureOffset: noop,
  setStartTimecode: noop,
  setFrameRate: noop,
  setPictureAudioEnabled: noop,
  togglePictureWindow: noop,
  setShowStreamers: noop,
  resync: noop,
  alignToPlayhead: noop,
  addHitPoint: () => "",
  moveHitPoint: noop,
  labelHitPoint: noop,
  setHitPointLocked: noop,
  removeHitPoint: noop,
};

interface VideoSyncStore {
  state: VideoSyncState;
  actions: VideoSyncActions;
  _patch: (partial: Partial<VideoSyncState>) => void;
  _setActions: (actions: VideoSyncActions) => void;
}

const useStore = create<VideoSyncStore>()((set) => ({
  state: initialState(),
  actions: FALLBACK_ACTIONS,
  _patch: (partial) =>
    set((store) => {
      const next = { ...store.state, ...partial };
      const unchanged = (Object.keys(partial) as (keyof VideoSyncState)[]).every(
        (key) => store.state[key] === next[key],
      );
      return unchanged ? store : { ...store, state: next };
    }),
  _setActions: (actions) => set((store) => (store.actions === actions ? store : { ...store, actions })),
}));

/** Merge a partial update into the video-sync state. */
export function patchVideoSyncState(partial: Partial<VideoSyncState>): void {
  useStore.getState()._patch(partial);
}

/** Install the provider's live action closures. */
export function setVideoSyncActions(actions: VideoSyncActions): void {
  useStore.getState()._setActions(actions);
}

/** Reset to the no-media baseline (used when the provider unmounts). */
export function resetVideoSyncState(): void {
  useStore.getState()._patch(initialState());
}

/**
 * Non-reactive read of the current state.
 *
 * For callers outside React (the controller's own assertions, tests) that need
 * the value once rather than a subscription.
 */
export function getVideoSyncState(): VideoSyncState {
  return useStore.getState().state;
}

/** Read-only access to the current video-sync state. */
export function useVideoSyncState(): VideoSyncState {
  return useStore((store) => store.state);
}

/** Access video-sync control actions. */
export function useVideoSyncActions(): VideoSyncActions {
  return useStore((store) => store.actions);
}
