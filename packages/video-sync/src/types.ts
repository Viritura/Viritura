/**
 * Public contracts for `@viritura/video-sync`.
 *
 * The **persisted** shapes (`VideoSyncSettings`, `VideoMediaIdentity`) live in
 * `@viritura/core` alongside the rest of the score model and are re-exported
 * here for convenience — there is exactly one definition of what a score stores.
 *
 * What this module owns are the **runtime** contracts (`TransportBridge`,
 * `SyncedVideoElement`): the seams the synchronizer talks through so it never
 * reaches into the playback provider's internals and never hard-depends on a
 * real DOM element.
 */

import type { VideoSyncSettings } from "@viritura/core";

export type { VideoMediaIdentity, VideoSyncSettings, HitPoint } from "@viritura/core";

/** Transport states the synchronizer distinguishes. */
export type TransportStatus = "stopped" | "playing" | "paused" | "loading";

/**
 * Narrow, read/write view of Viritura's playback transport.
 *
 * The transport is the master clock: the video follows it. Implementations
 * wrap `@viritura/playback` (editor) or a stub (tests / Storybook).
 */
export interface TransportBridge {
  /** Current score time in seconds. May be negative during a count-in. */
  getScoreTimeSeconds(): number;
  /** Current transport status. */
  getStatus(): TransportStatus;
  /** Start or resume playback, optionally from an explicit score time. */
  play(fromSeconds?: number): void | Promise<void>;
  /** Pause playback, preserving position. */
  pause(): void;
  /** Seek to an absolute score time in seconds. */
  seekSeconds(seconds: number): void;
}

/**
 * The subset of `HTMLVideoElement` the synchronizer uses.
 *
 * Declaring it structurally keeps the controller testable under Node (no jsdom
 * required) and documents exactly which media surface area we depend on.
 */
export interface SyncedVideoElement {
  currentTime: number;
  playbackRate: number;
  muted: boolean;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly duration: number;
  readonly readyState: number;
  readonly seeking: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/**
 * Identity of the attached picture, persisted in the score.
 *
 * Defined in `@viritura/core` and re-exported above. `contentHash` is what makes
 * a relink verifiable: reopening a project on a machine that has the file lets
 * us confirm the user picked the same cut rather than a revised one that would
 * silently shift every sync point.
 */

/** Current version of the persisted `videoSync` payload. */
export const VIDEO_SYNC_SETTINGS_VERSION = 1;

/** Settings for a score that has never attached a video. */
export function defaultVideoSyncSettings(): VideoSyncSettings {
  return {
    version: VIDEO_SYNC_SETTINGS_VERSION,
    pictureOffsetSeconds: 0,
    pictureAudioEnabled: false,
  };
}

/** Lifecycle of the attached media, as surfaced to the UI. */
export type VideoAttachmentStatus =
  /** No media attached to this score. */
  | "empty"
  /** Score names a video, but this device has no binding for it yet. */
  | "offline"
  /** Media is being read/decoded. */
  | "loading"
  /** Media is attached and playable. */
  | "ready"
  /** Media failed to load (unsupported codec, revoked handle, network). */
  | "error";

/** How closely the picture is currently tracking the transport. */
export type VideoSyncHealth =
  /** Within tolerance. */
  | "locked"
  /** Outside tolerance; a correction is in flight. */
  | "correcting"
  /** The element is starved of data. */
  | "buffering"
  /** Nothing to track (no media, or transport stopped and idle). */
  | "idle";
