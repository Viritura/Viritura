/**
 * @viritura/video-sync — score-to-picture synchronization.
 *
 * Basic "Video Reference" tier: a reference cut locked to Viritura's transport
 * through the score's own tempo model, displayed in the browser's standard
 * Picture-in-Picture window (with an inline floating fallback where PiP is
 * unavailable).
 *
 * Explicitly out of scope here: reconforming a cue when the cut changes. See\n * `docs/plans/video-sync.md`.
 */

// Timing core (pure, DOM-free)
export {
  hasPictureAt,
  mediaTimeForScoreTime,
  offsetAligning,
  placeScoreTime,
  scoreTimeForMediaTime,
  type MediaPlacement,
  type PictureMapping,
} from "./scorePictureMap";
export { formatClockTime, formatPictureTimecode, formatShortClockTime, parseClockTime } from "./timecode";
export {
  DEFAULT_FRAME_RATE_ID,
  FRAME_RATES,
  formatFrameTimecode,
  formatTimecode,
  fps,
  frameDuration,
  frameError,
  frameForSeconds,
  frameRateById,
  labelFps,
  parseFrameTimecode,
  parseTimecodeSeconds,
  secondsForFrame,
  snapToFrame,
  type FrameRateSpec,
} from "./smpte";
export {
  DEFAULT_DRIFT_POLICY,
  decideCorrection,
  isOutOfTolerance,
  type DriftCorrection,
  type DriftPolicyOptions,
  type DriftSample,
} from "./driftPolicy";

// Controller
export { VideoSynchronizer, type SyncScheduler, type VideoSynchronizerOptions } from "./videoSynchronizer";
export { VideoSyncController, type VideoSyncControllerOptions } from "./videoSyncController";

// Platform adapters
export {
  computeMediaContentHash,
  looksLikeVideoFile,
  matchesIdentity,
  releaseMediaBinding,
  VIDEO_FILE_ACCEPT,
  type HashableFile,
  type MediaBinding,
} from "./mediaBinding";
export { CAMINANDES_LLAMIGOS, DEMO_VIDEO_SOURCES, findDemoVideoSource, type DemoVideoSource } from "./demoSources";

// Fitting bars to picture.
export { beatsPerBar, exactTempo, fitSpan } from "./fitSpan";
export type { SpanFit, SpanFitCandidate, SpanFitRequest, TimeSignature } from "./cueTypes";

// The spotting timeline.
export { TimelineCanvas, type TimelineCanvasProps } from "./TimelineCanvas";
export { computePeaks, peaksForRange, PEAK_BUCKETS_PER_SECOND, type PeakData } from "./waveformPeaks";
export { buildWaveform, cachedPeaks, forgetPeaks } from "./waveformSource";
export { FilmstripExtractor, decodeQuantum, filmstripSlots, type DecodedFrame, type FilmstripSlot } from "./filmstrip";
export { useFilmstrip, type FilmstripRequest } from "./useFilmstrip";
export {
  resolveBars,
  resolveHits,
  spanAt,
  markerIntervals,
  markerIntervalAt,
  hitNear,
  barSpanFor,
  type TempoLookup,
  type TimelineMarkerInterval,
} from "./resolveTimeline";
export {
  normalizePlan,
  planBars,
  planBeats,
  planMeters,
  removeSegment,
  setSegmentBars,
  setSegmentMeter,
  solvePlan,
  splitSegment,
  suggestPlan,
  type PlanSegment,
  type SpanPlan,
  type SpanSolution,
} from "./spanPlan";
export { planPatches, type ApplyPlanRequest, type PlanApplication } from "./planPatches";
export {
  chooseTickInterval,
  clampViewport,
  fitViewport,
  normalizeSafeAreaLeft,
  secondsForX,
  shiftViewportSafeArea,
  ticksFor,
  xForSeconds,
  zoomAt,
  zoomLimitsFor,
} from "./timelineGeometry";
export type {
  TimelineBar,
  TimelineHit,
  TimelineScene,
  TimelineThumbnail,
  TimelineViewport,
  TimelineWaveform,
} from "./timelineTypes";

// Contracts
export {
  defaultVideoSyncSettings,
  VIDEO_SYNC_SETTINGS_VERSION,
  type SyncedVideoElement,
  type TransportBridge,
  type TransportStatus,
  type VideoAttachmentStatus,
  type VideoMediaIdentity,
  type VideoSyncHealth,
  type VideoSyncSettings,
} from "./types";

// React surface
export { VideoSyncProvider, type VideoSyncProviderProps } from "./VideoSyncProvider";
export { VideoPanel, type VideoPanelProps } from "./VideoPanel";
export { VideoStage, type VideoStageProps } from "./VideoStage";
export { PictureWindow, type PictureWindowProps } from "./PictureWindow";
export { PictureSurface, type PictureSurfaceProps } from "./PictureSurface";
export {
  closePictureWindow,
  currentPictureWindow,
  isDocumentPipSupported,
  openPictureWindow,
} from "./documentPictureInPicture";
export {
  DEFAULT_STREAMER_SECONDS,
  streamerState,
  streamerX,
  type ActiveStreamer,
  type StreamerOptions,
  type StreamerState,
} from "./streamers";
export {
  getVideoSyncState,
  useVideoSyncActions,
  useVideoSyncState,
  type VideoSyncActions,
  type VideoSyncState,
} from "./videoSyncStore";
