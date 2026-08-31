/**
 * VideoSyncController — the non-React half of the video feature.
 *
 * Owns the media element, the synchronizer, the PiP subscription, and the
 * translation between persisted `VideoSyncSettings` and live store state. Kept
 * out of the provider component so the React file stays components-only (the
 * `react-refresh/only-export-components` rule) and so this logic can be
 * exercised without a renderer.
 *
 * Everything the user can change flows through here in one direction:
 *
 *     user action -> controller -> store (UI) + onSettingsChange (score)
 *
 * The score is the durable record; the store is what the panel renders. Keeping
 * one writer avoids the classic bug where a control updates the UI but never
 * reaches the document (or vice versa) and the setting silently reverts on
 * reload.
 */

import type { VideoSyncSettings } from "@viritura/core";
import { findDemoVideoSource, type DemoVideoSource } from "./demoSources";
import {
  computeMediaContentHash,
  fetchMediaBlob,
  looksLikeVideoFile,
  matchesIdentity,
  releaseMediaBinding,
  type MediaBinding,
} from "./mediaBinding";
import type { DetectedMediaMetadata } from "./mediaMetadata";
import { analyzeMediaMetadata } from "./mediaMetadataSource";
import { offsetAligning, type PictureMapping } from "./scorePictureMap";
import { frameRateById, parseFrameTimecode, secondsForFrame } from "./smpte";
import { buildWaveform, cachedPeaks } from "./waveformSource";
import type { HitPoint, TransportBridge } from "./types";
import { VIDEO_SYNC_SETTINGS_VERSION } from "./types";
import { VideoSynchronizer } from "./videoSynchronizer";
import { getVideoSyncState, patchVideoSyncState, type VideoSyncActions } from "./videoSyncStore";

/** How often the timecode readout refreshes. */
const READOUT_INTERVAL_MS = 100;

/** Settings for a score that has never attached a video. */
function emptySettings(): VideoSyncSettings {
  return {
    version: VIDEO_SYNC_SETTINGS_VERSION,
    pictureOffsetSeconds: 0,
    pictureAudioEnabled: false,
  };
}

function supportsDropFrameNumbering(rate: ReturnType<typeof frameRateById>): boolean {
  return rate.denominator === 1001 && (rate.numerator === 30000 || rate.numerator === 60000);
}

export interface VideoSyncControllerOptions {
  transport: TransportBridge;
  /** Persist a settings change back to the score. */
  onSettingsChange(settings: VideoSyncSettings | undefined): void;
  /** Injectable so metadata adoption is testable without a real Worker/WASM. */
  analyzeMetadata?: typeof analyzeMediaMetadata;
}

export class VideoSyncController {
  private readonly options: VideoSyncControllerOptions;
  private readonly synchronizer: VideoSynchronizer;

  private video: HTMLVideoElement | null = null;
  private settings: VideoSyncSettings = emptySettings();
  private binding: MediaBinding | null = null;
  private readoutTimer: ReturnType<typeof setInterval> | null = null;
  /** In-flight demo download, so a superseding attach can cancel it. */
  private demoFetch: AbortController | null = null;
  /** Demo id `demoFetch` is downloading; guards against restarting it. */
  private demoFetchId: string | null = null;
  /** Metadata parse for the current binding, cancellable on relink/removal. */
  private metadataAnalysis: AbortController | null = null;
  /** Monotonic token: only the newest asynchronous attachment may install. */
  private attachmentGeneration = 0;
  /** Identity of the document the current binding belongs to. */
  private documentToken: unknown;

  constructor(options: VideoSyncControllerOptions) {
    this.options = options;
    this.synchronizer = new VideoSynchronizer({
      transport: options.transport,
      getMapping: () => this.mapping(),
      onHealthChange: (health) => patchVideoSyncState({ health }),
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Invalidate all media work when the editor opens another document.
   *
   * The provider stays mounted across document switches. Without a stable
   * document token, a hash or MediaInfo worker started by score A could finish
   * later and persist into score B through the bridge's now-current callback.
   */
  setDocumentToken(token: unknown): void {
    if (Object.is(this.documentToken, token)) return;
    this.documentToken = token;
    this.attachmentGeneration += 1;
    this.abortDemoFetch();
    this.abortMetadataAnalysis();
    this.synchronizer.detach();
    this.stopReadout();
    releaseMediaBinding(this.binding);
    this.binding = null;
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
    }
    patchVideoSyncState({
      attachment: "empty",
      health: "idle",
      mediaName: null,
      mediaDurationSeconds: null,
      mediaObjectUrl: null,
      currentMediaTime: 0,
      downloadProgress: null,
      identityMismatch: false,
      attribution: null,
      attributionUrl: null,
      errorMessage: null,
      waveform: null,
      waveformStatus: "idle",
      mediaMetadata: null,
      mediaMetadataStatus: "idle",
      mediaMetadataError: null,
      pictureWindowOpen: false,
      frameRateSource: "default",
      timecodeOriginSource: "default",
    });
  }

  /** Bind (or unbind) the media element the provider rendered. */
  setElement(video: HTMLVideoElement | null): void {
    if (this.video === video) return;

    this.synchronizer.detach();
    this.video = video;

    if (!video) {
      this.stopReadout();
      return;
    }

    video.muted = !this.settings.pictureAudioEnabled;

    if (this.binding) {
      // Media was attached before the element existed (a demo restored from
      // settings while the provider was still mounting). Point the element at
      // the source now rather than attaching a synchronizer to a blank video.
      video.src = this.binding.objectUrl;
      video.load();
      this.synchronizer.attach(video);
      this.startReadout();
    }
  }

  /**
   * Apply settings loaded from the score.
   *
   * Called whenever the open document changes. Media is *not* auto-attached for
   * local files — the browser cannot reopen a file the user picked in a previous
   * session — so a score that remembers one lands in the `offline` state with a
   * relink affordance. Demo clips stream from a public URL and so can restore
   * themselves.
   */
  applySettings(settings: VideoSyncSettings | undefined): void {
    this.settings = settings ?? emptySettings();
    const state = getVideoSyncState();
    const frameRateId = frameRateById(this.settings.frameRate).id;
    const frameRateSource =
      this.settings.frameRate === undefined
        ? "default"
        : state.frameRateId === frameRateId &&
            (state.frameRateSource === "detected" || state.frameRateSource === "manual")
          ? state.frameRateSource
          : "saved";
    const origin = this.settings.startTimecodeSeconds ?? 0;
    const timecodeOriginSource =
      this.settings.startTimecodeSeconds === undefined
        ? "default"
        : state.startTimecodeSeconds === origin &&
            (state.timecodeOriginSource === "detected" || state.timecodeOriginSource === "manual")
          ? state.timecodeOriginSource
          : "saved";
    patchVideoSyncState({
      pictureOffsetSeconds: this.settings.pictureOffsetSeconds,
      pictureAudioEnabled: this.settings.pictureAudioEnabled,
      startTimecodeSeconds: origin,
      frameRateId,
      frameRateSource,
      timecodeOriginSource,
      mediaName: this.settings.media?.displayName ?? null,
      mediaDurationSeconds: this.settings.media?.durationSeconds ?? null,
      hitPoints: this.settings.hitPoints ?? [],
    });
    if (this.video) this.video.muted = !this.settings.pictureAudioEnabled;

    if (this.binding) {
      this.synchronizer.resync();
      return;
    }

    const demoId = this.settings.media?.demoSourceId;
    // The document store hands out a new score object on every edit, so this
    // runs far more often than the media actually changes. Without this guard a
    // stray keystroke would cancel and restart the clip download.
    if (demoId && demoId === this.demoFetchId) return;

    const demo = demoId ? findDemoVideoSource(demoId) : undefined;
    if (demo) {
      void this.attachDemo(demo);
      return;
    }

    patchVideoSyncState({ attachment: this.settings.media ? "offline" : "empty" });
  }

  /** Re-anchor after the score's playback timeline was regenerated. */
  notifyTimelineChanged(): void {
    if (this.binding) this.synchronizer.resync();
  }

  /** Release everything. */
  dispose(): void {
    this.attachmentGeneration += 1;
    this.abortDemoFetch();
    this.abortMetadataAnalysis();
    this.stopReadout();
    this.synchronizer.dispose();
    releaseMediaBinding(this.binding);
    this.binding = null;
    this.video = null;
  }

  // ── Actions exposed to the UI ───────────────────────────────────────────

  actions(): VideoSyncActions {
    return {
      attachFile: (file) => this.attachFile(file),
      attachDemo: (source) => this.attachDemo(source),
      removeMedia: () => this.removeMedia(),
      setPictureOffset: (seconds) => this.setPictureOffset(seconds),
      setStartTimecode: (seconds) => this.setStartTimecode(seconds),
      setFrameRate: (id) => this.setFrameRate(id),
      setPictureAudioEnabled: (enabled) => this.setPictureAudioEnabled(enabled),
      togglePictureWindow: () => this.togglePictureWindow(),
      setShowStreamers: (show) => patchVideoSyncState({ showStreamers: show }),
      resync: () => this.synchronizer.resync(),
      alignToPlayhead: () => this.alignToPlayhead(),
      addHitPoint: (seconds, label) => this.addHitPoint(seconds, label),
      moveHitPoint: (id, seconds) => this.updateHitPoint(id, (hit) => ({ ...hit, pictureSeconds: seconds })),
      labelHitPoint: (id, label) => this.updateHitPoint(id, (hit) => ({ ...hit, label })),
      setHitPointLocked: (id, locked) =>
        this.updateHitPoint(id, (hit) => {
          // `locked` defaults to true, so only the exception is persisted.
          const { locked: _drop, ...rest } = hit;
          return locked ? rest : { ...rest, locked: false };
        }),
      removeHitPoint: (id) => this.persistHits(this.hits().filter((hit) => hit.id !== id)),
    };
  }

  // ── Spotting ────────────────────────────────────────────────────────────

  private hits(): HitPoint[] {
    return this.settings.hitPoints ?? [];
  }

  /**
   * Mark a moment in the picture.
   *
   * Clamped to the clip because a hit outside it describes nothing, and would
   * give the solver a span it can never fill.
   */
  private addHitPoint(pictureSeconds: number, label?: string): string {
    const duration = this.settings.media?.durationSeconds ?? this.video?.duration;
    const upper = Number.isFinite(duration) && duration ? duration : Number.POSITIVE_INFINITY;
    const seconds = Math.min(Math.max(0, pictureSeconds), upper);

    const hit: HitPoint = { id: crypto.randomUUID(), pictureSeconds: seconds, ...(label ? { label } : {}) };
    this.persistHits([...this.hits(), hit]);
    return hit.id;
  }

  private updateHitPoint(id: string, change: (hit: HitPoint) => HitPoint): void {
    const hits = this.hits();
    if (!hits.some((hit) => hit.id === id)) return;
    this.persistHits(hits.map((hit) => (hit.id === id ? change(hit) : hit)));
  }

  private persistHits(hits: readonly HitPoint[]): void {
    const sorted = [...hits].sort((a, b) => a.pictureSeconds - b.pictureSeconds);
    const { hitPoints: _previous, ...rest } = this.settings;
    this.persist(sorted.length > 0 ? { ...rest, hitPoints: sorted } : rest);
    patchVideoSyncState({ hitPoints: sorted });
  }

  private async attachFile(file: File): Promise<void> {
    this.abortDemoFetch();
    if (!looksLikeVideoFile(file.name)) {
      patchVideoSyncState({
        attachment: "error",
        errorMessage: `${file.name} is not a supported MOV, MP4/M4V, or WebM reference picture.`,
      });
      return;
    }
    const generation = ++this.attachmentGeneration;
    // Invalidate the old file before hashing the new one. Hashing can take long
    // enough for the previous worker to finish; if it persisted its rate in
    // that window, the new file would see a now-declared rate and refuse to
    // adopt its own authoritative metadata.
    this.abortMetadataAnalysis();

    patchVideoSyncState({
      attachment: "loading",
      errorMessage: null,
      downloadProgress: null,
      attribution: null,
      attributionUrl: null,
      mediaMetadata: null,
      mediaMetadataStatus: "loading",
      mediaMetadataError: null,
    });

    const hash = await computeMediaContentHash(file);
    if (generation !== this.attachmentGeneration) return;
    // A relink against a different cut is the failure that quietly invalidates
    // every sync point, so it is surfaced rather than silently accepted.
    const remembered = this.settings.media;
    const mismatch = !!remembered?.contentHash && !matchesIdentity(remembered, hash);

    this.replaceBinding({
      identity: { displayName: file.name, ...(hash ? { contentHash: hash } : {}) },
      objectUrl: URL.createObjectURL(file),
      blob: file,
    });
    patchVideoSyncState({ identityMismatch: mismatch });
  }

  private async attachDemo(source: DemoVideoSource): Promise<void> {
    this.abortDemoFetch();
    const generation = ++this.attachmentGeneration;
    // The download precedes `replaceBinding`, so the old file's metadata must
    // be invalidated now rather than after the network request completes.
    this.abortMetadataAnalysis();
    const fetchController = new AbortController();
    this.demoFetch = fetchController;
    this.demoFetchId = source.id;

    patchVideoSyncState({
      attachment: "loading",
      errorMessage: null,
      identityMismatch: false,
      downloadProgress: 0,
      mediaName: source.title,
      attribution: `${source.attribution} — ${source.license}`,
      attributionUrl: source.sourcePageUrl,
      mediaMetadata: null,
      mediaMetadataStatus: "loading",
      mediaMetadataError: null,
    });

    try {
      const blob = await fetchMediaBlob(
        source.url,
        (fraction) => {
          // A superseding attach already won; its progress must not be clobbered.
          if (this.demoFetch !== fetchController || generation !== this.attachmentGeneration) return;
          patchVideoSyncState({ downloadProgress: fraction });
        },
        fetchController.signal,
      );
      if (this.demoFetch !== fetchController) return;
      this.demoFetch = null;
      this.demoFetchId = null;

      this.replaceBinding({
        identity: {
          displayName: source.title,
          demoSourceId: source.id,
          durationSeconds: source.durationSeconds,
        },
        objectUrl: URL.createObjectURL(blob),
        blob,
      });
      patchVideoSyncState({ downloadProgress: null });
    } catch (error) {
      if (fetchController.signal.aborted) return;
      this.demoFetch = null;
      this.demoFetchId = null;
      patchVideoSyncState({
        attachment: "error",
        downloadProgress: null,
        errorMessage: error instanceof Error ? error.message : "The demo clip could not be downloaded.",
      });
    }
  }

  /** Cancel an in-flight demo download so a superseding attach wins cleanly. */
  private abortDemoFetch(): void {
    this.demoFetch?.abort();
    this.demoFetch = null;
    this.demoFetchId = null;
  }

  private replaceBinding(binding: MediaBinding): void {
    releaseMediaBinding(this.binding);
    this.abortMetadataAnalysis();
    this.binding = binding;

    this.persist({
      ...this.settings,
      media: binding.identity,
    });
    patchVideoSyncState({
      mediaName: binding.identity.displayName,
      mediaDurationSeconds: binding.identity.durationSeconds ?? null,
      mediaObjectUrl: binding.objectUrl,
      mediaMetadata: null,
      mediaMetadataStatus: "loading",
      mediaMetadataError: null,
    });
    void this.decodeWaveform(binding);
    void this.readMediaMetadata(binding);

    const video = this.video;
    if (!video) return;

    video.src = binding.objectUrl;
    video.muted = !this.settings.pictureAudioEnabled;
    video.load();
    this.synchronizer.attach(video);
    this.startReadout();
  }

  /**
   * Read the selected file's timing metadata without delaying attachment.
   *
   * MediaInfo lives in a worker and requests byte ranges from the Blob, so a
   * multi-gigabyte reference is never copied wholesale. A stale result cannot
   * win after relink: both an AbortSignal and the binding identity guard it.
   */
  private async readMediaMetadata(binding: MediaBinding): Promise<void> {
    const analysis = new AbortController();
    this.metadataAnalysis = analysis;
    try {
      const metadata = await (this.options.analyzeMetadata ?? analyzeMediaMetadata)(binding.blob, analysis.signal);
      if (analysis.signal.aborted || this.binding !== binding) return;
      this.metadataAnalysis = null;
      patchVideoSyncState({
        mediaMetadata: metadata,
        mediaMetadataStatus: "ready",
        mediaMetadataError: null,
      });
      this.applyDetectedTiming(metadata);
    } catch (error) {
      if (analysis.signal.aborted || this.binding !== binding) return;
      this.metadataAnalysis = null;
      patchVideoSyncState({
        mediaMetadata: null,
        mediaMetadataStatus: "error",
        mediaMetadataError: error instanceof Error ? error.message : "The picture's metadata could not be read.",
      });
    }
  }

  /**
   * Adopt unambiguous metadata only when the score has no declared rate.
   *
   * NTSC metadata without an explicit DF/NDF flag deliberately has no
   * suggestion: 30000/1001 determines frame duration, but not how SMPTE labels
   * are numbered. In that case the panel shows the detection and asks the
   * composer to choose.
   */
  private applyDetectedTiming(metadata: DetectedMediaMetadata): void {
    const detected = metadata.frameRate;
    if (!detected || detected.mode === "variable") return;

    let next = this.settings;
    let changed = false;
    const id = detected.suggestedFrameRateId;
    if (id && detected.confidence === "high" && next.frameRate === undefined) {
      next = { ...next, frameRate: id };
      changed = true;
    }

    const rate = next.frameRate ? frameRateById(next.frameRate) : null;
    const firstFrame = metadata.timecode.firstFrame;
    const rateMatches =
      rate !== null &&
      rate.numerator === detected.numerator &&
      rate.denominator === detected.denominator &&
      (!supportsDropFrameNumbering(rate) ||
        (metadata.timecode.dropFrame !== null && rate.dropFrame === metadata.timecode.dropFrame));
    if (firstFrame && rateMatches && next.startTimecodeSeconds === undefined) {
      const frame = parseFrameTimecode(firstFrame, rate);
      if (frame !== null) {
        next = { ...next, startTimecodeSeconds: secondsForFrame(frame, rate) };
        changed = true;
      }
    }

    if (!changed) return;
    const frameRateChanged = next.frameRate !== this.settings.frameRate;
    const originChanged = next.startTimecodeSeconds !== this.settings.startTimecodeSeconds;
    this.persist(next);
    patchVideoSyncState({
      frameRateId: next.frameRate ? frameRateById(next.frameRate).id : getVideoSyncState().frameRateId,
      frameRateSource: frameRateChanged ? "detected" : getVideoSyncState().frameRateSource,
      startTimecodeSeconds: next.startTimecodeSeconds ?? 0,
      timecodeOriginSource: originChanged ? "detected" : getVideoSyncState().timecodeOriginSource,
    });
  }

  private abortMetadataAnalysis(): void {
    this.metadataAnalysis?.abort();
    this.metadataAnalysis = null;
  }

  /**
   * Decode the clip's audio into a drawable envelope.
   *
   * Deliberately fire-and-forget: the picture must be usable the instant it is
   * attached, and the waveform is an aid to finding things, not a precondition
   * for anything. A `generation` guard drops the result if the composer attached
   * something else while this was decoding.
   */
  private async decodeWaveform(binding: MediaBinding): Promise<void> {
    const key = binding.identity.contentHash ?? binding.identity.demoSourceId ?? binding.objectUrl;
    const cached = cachedPeaks(key);
    if (cached) {
      patchVideoSyncState({ waveform: cached, waveformStatus: "ready" });
      return;
    }

    patchVideoSyncState({ waveform: null, waveformStatus: "loading" });
    try {
      const peaks = await buildWaveform(binding.blob, { key });
      if (this.binding !== binding) return;
      patchVideoSyncState({
        waveform: peaks,
        waveformStatus: peaks ? "ready" : "unavailable",
      });
    } catch {
      if (this.binding !== binding) return;
      patchVideoSyncState({ waveform: null, waveformStatus: "unavailable" });
    }
  }

  private removeMedia(): void {
    this.attachmentGeneration += 1;
    this.abortDemoFetch();
    this.abortMetadataAnalysis();
    this.synchronizer.detach();
    this.stopReadout();
    releaseMediaBinding(this.binding);
    this.binding = null;

    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
    }

    const { media: _removed, ...rest } = this.settings;
    // Offset and audio preference survive: they describe how the composer works
    // with this cue, not the specific file, and re-entering them after a relink
    // is exactly the busywork video sync is supposed to remove.
    this.persist(rest);
    patchVideoSyncState({
      attachment: "empty",
      health: "idle",
      mediaName: null,
      mediaDurationSeconds: null,
      mediaObjectUrl: null,
      mediaMetadata: null,
      mediaMetadataStatus: "idle",
      mediaMetadataError: null,
      currentMediaTime: 0,
      downloadProgress: null,
      identityMismatch: false,
      attribution: null,
      attributionUrl: null,
      errorMessage: null,
      waveform: null,
      waveformStatus: "idle",
      frameRateSource: rest.frameRate ? "saved" : "default",
      timecodeOriginSource: rest.startTimecodeSeconds !== undefined ? "saved" : "default",
    });
  }

  private setPictureOffset(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.persist({ ...this.settings, pictureOffsetSeconds: seconds });
    patchVideoSyncState({ pictureOffsetSeconds: seconds });
    if (this.binding) this.synchronizer.resync();
  }

  private setStartTimecode(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.persist({ ...this.settings, startTimecodeSeconds: seconds });
    patchVideoSyncState({
      startTimecodeSeconds: seconds,
      timecodeOriginSource: "manual",
    });
  }

  private setFrameRate(id: string): void {
    const rate = frameRateById(id);
    this.persist({ ...this.settings, frameRate: rate.id });
    const state = getVideoSyncState();
    patchVideoSyncState({
      frameRateId: rate.id,
      frameRateSource: "manual",
      // The origin is stored as elapsed seconds. A different timebase can map
      // those seconds to another SMPTE label, so that displayed label is no
      // longer honestly "Detected" even though the underlying seconds remain.
      timecodeOriginSource: state.timecodeOriginSource === "detected" ? "saved" : state.timecodeOriginSource,
    });
  }

  private setPictureAudioEnabled(enabled: boolean): void {
    this.persist({ ...this.settings, pictureAudioEnabled: enabled });
    patchVideoSyncState({ pictureAudioEnabled: enabled });
    if (this.video) this.video.muted = !enabled;
  }

  /**
   * Open or close the pop-out picture window.
   *
   * The window itself is owned by React (see `PictureWindow`); the controller
   * only holds the intent, so the surface can be re-rendered, restyled, or
   * fall back to an in-page panel without the controller knowing.
   */
  private togglePictureWindow(): void {
    patchVideoSyncState({ pictureWindowOpen: !getVideoSyncState().pictureWindowOpen });
  }

  private alignToPlayhead(): void {
    const video = this.video;
    if (!video) return;
    this.setPictureOffset(offsetAligning(this.options.transport.getScoreTimeSeconds(), video.currentTime));
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private mapping(): PictureMapping {
    const duration = this.video?.duration;
    return {
      pictureOffsetSeconds: this.settings.pictureOffsetSeconds,
      mediaDurationSeconds: Number.isFinite(duration) ? duration : undefined,
    };
  }

  private persist(settings: VideoSyncSettings): void {
    const previous = this.settings;
    this.settings = settings;
    const isPristine =
      !settings.media &&
      settings.pictureOffsetSeconds === 0 &&
      !settings.pictureAudioEnabled &&
      !settings.startTimecodeSeconds &&
      settings.frameRate === undefined &&
      !settings.hitPoints?.length;
    const next = isPristine ? undefined : settings;

    // Restoring a demo clip on document load re-derives an identical settings
    // object. Writing it back would mark a freshly opened score dirty and
    // trigger a publish that the user never asked for.
    if (settingsEqual(previous, next)) return;

    // Don't leave an inert `videoSync` block in scores that never used the
    // feature; MNX diffs stay clean for everyone else.
    this.options.onSettingsChange(next);
  }

  /**
   * Refresh the timecode readout on a timer rather than from the sync loop.
   *
   * The synchronizer runs at frame rate; pushing that into React state would
   * re-render the panel 60 times a second to move a millisecond digit.
   */
  private startReadout(): void {
    if (this.readoutTimer !== null) return;
    this.readoutTimer = setInterval(() => {
      const video = this.video;
      if (!video) return;
      const isDemo = this.binding?.identity.demoSourceId !== undefined;
      patchVideoSyncState({
        currentMediaTime: video.currentTime,
        mediaDurationSeconds: Number.isFinite(video.duration) ? video.duration : null,
        attachment: video.error ? "error" : video.readyState > 0 ? "ready" : "loading",
        errorMessage: video.error ? mediaErrorMessage(video.error, isDemo) : null,
      });
    }, READOUT_INTERVAL_MS);
  }

  private stopReadout(): void {
    if (this.readoutTimer !== null) clearInterval(this.readoutTimer);
    this.readoutTimer = null;
  }
}

/**
 * Value-equality for persisted settings.
 *
 * Deliberately field-by-field rather than a JSON comparison: key order is not
 * part of the value, and a stray key-order difference would defeat the guard it
 * exists to provide.
 */
function settingsEqual(a: VideoSyncSettings | undefined, b: VideoSyncSettings | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.version === b.version &&
    a.pictureOffsetSeconds === b.pictureOffsetSeconds &&
    a.pictureAudioEnabled === b.pictureAudioEnabled &&
    (a.startTimecodeSeconds ?? 0) === (b.startTimecodeSeconds ?? 0) &&
    a.frameRate === b.frameRate &&
    a.media?.displayName === b.media?.displayName &&
    a.media?.contentHash === b.media?.contentHash &&
    a.media?.demoSourceId === b.media?.demoSourceId &&
    a.media?.durationSeconds === b.media?.durationSeconds &&
    hitsEqual(a.hitPoints, b.hitPoints)
  );
}

/** Value-equality for a spotting session. */
function hitsEqual(a: readonly HitPoint[] | undefined, b: readonly HitPoint[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((hit, index) => {
    const other = right[index]!;
    return (
      hit.id === other.id &&
      hit.pictureSeconds === other.pictureSeconds &&
      hit.label === other.label &&
      (hit.locked !== false) === (other.locked !== false)
    );
  });
}

/** Translate a `MediaError` into something a composer can act on. */
function mediaErrorMessage(error: MediaError, isDemo: boolean): string {
  switch (error.code) {
    case 1:
      return "Loading the video was aborted.";
    case 2:
      return "The video could not be loaded (network error).";
    case 3:
      return "The video could not be decoded.";
    case 4:
      // The bytes are already local by this point (both a picked file and a
      // demo clip play from an object URL), so this is a codec gap in the
      // browser, not a transfer problem — and for a demo the user did not
      // choose the format, so telling them to pick a different file is wrong.
      return isDemo
        ? "The demo clip downloaded, but this browser cannot decode it (VP9/WebM). Try Chrome, Edge or Firefox, or attach your own MP4."
        : "This browser cannot play that video format. Try an MP4 (H.264) or WebM file.";
    default:
      return "The video could not be played.";
  }
}
