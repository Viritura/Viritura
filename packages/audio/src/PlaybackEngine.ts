import { Scheduler } from "./Scheduler";
import type {
  ISampler,
  MidiEvent,
  MidiTimeline,
  PlaybackEventCallback,
  PlaybackEventMap,
  PlaybackEngineOptions,
  PlaybackState,
  PlayheadPosition,
  PlayheadResolver,
  ClickEvent,
  ClickCallback,
} from "./types";
import { DEFAULT_ENGINE_OPTIONS } from "./types";

/**
 * PlaybackEngine — central orchestrator for audio playback.
 *
 * Ties together:
 * - A MidiTimeline (time-ordered note events generated from a Score)
 * - A per-part sampler map (ISampler instances keyed by part index)
 * - A Scheduler (windowed look-ahead using audioContext.currentTime)
 *
 * Usage:
 *   const engine = new PlaybackEngine(audioContext);
 *   engine.loadTimeline(timeline, samplers);
 *   engine.on("playhead", (detail) => updateUI(detail.position));
 *   engine.play();
 */
export class PlaybackEngine {
  private readonly audioContext: AudioContext;
  private readonly options: Required<PlaybackEngineOptions>;

  // State
  private state: PlaybackState = "stopped";
  private timeline: MidiTimeline | null = null;
  private samplers: ReadonlyMap<number | string, ISampler> = new Map();
  private lanePartIndices: ReadonlyMap<string, number> = new Map();
  private scheduler: Scheduler | null = null;
  /** True when the timeline contains any programChange/controlChange events,
   *  so playback start can skip the sticky-state chase when there's nothing
   *  to chase (the common, technique-free case). */
  private hasControlEvents = false;

  // Transport
  private pausedAtScoreTime = 0;
  private tempoScale = 1;
  private playheadTimerId: ReturnType<typeof setTimeout> | null = null;
  /** Optional tempo-model time→position inverse (see {@link setPlayheadResolver}). */
  private playheadResolver: PlayheadResolver | null = null;
  /** Pre-scheduled metronome click track in score time (see {@link setClickTrack}). */
  private clickTrack: readonly ClickEvent[] = [];
  /** Sink for scheduled clicks (see {@link setClickCallback}). */
  private clickCallback: ClickCallback | null = null;

  /**
   * When non-null, only events for part indices in this set are played.
   * Parts not in the filter are silenced (noteOn skipped, pending notes released).
   */
  private viewPartFilter: ReadonlySet<number> | null = null;

  // Event listeners
  private readonly listeners: {
    [K in keyof PlaybackEventMap]?: Set<PlaybackEventCallback<K>>;
  } = {};

  /** Bound `visibilitychange` handler so we can remove it on dispose. */
  private visibilityHandler: (() => void) | null = null;

  constructor(audioContext: AudioContext, options?: PlaybackEngineOptions) {
    this.audioContext = audioContext;
    this.options = {
      scheduleAheadTime: options?.scheduleAheadTime ?? DEFAULT_ENGINE_OPTIONS.scheduleAheadTime,
      tickIntervalMs: options?.tickIntervalMs ?? DEFAULT_ENGINE_OPTIONS.tickIntervalMs,
      playheadIntervalMs: options?.playheadIntervalMs ?? DEFAULT_ENGINE_OPTIONS.playheadIntervalMs,
      leadInTime: options?.leadInTime ?? DEFAULT_ENGINE_OPTIONS.leadInTime,
    };

    // When the tab returns from being backgrounded, force the scheduler to
    // tick immediately. Background tabs throttle setTimeout to ~1 Hz, so
    // events that should have been scheduled during the throttled period
    // are stale by the time the next tick runs. The scheduler's past-event
    // handling will release any held noteOffs as part of the catch-up tick.
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      this.visibilityHandler = () => {
        if (document.visibilityState === "visible" && this.scheduler) {
          this.scheduler.tickNow();
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  // ═══════════════════════════════════════════
  // Loading
  // ═══════════════════════════════════════════

  /**
   * Load a pre-generated MIDI timeline and associate samplers per part.
   *
   * @param timeline - The MIDI timeline (from the timeline generator, task 4.4).
   * @param samplers - Map of part index → ISampler instance.
   */
  loadTimeline(timeline: MidiTimeline, samplers: ReadonlyMap<number | string, ISampler>): void {
    if (this.state !== "stopped" || this.scheduler) this.stop();
    this.timeline = timeline;
    this.samplers = samplers;
    this.lanePartIndices = new Map(
      timeline.events
        .filter((event): event is MidiEvent & { playbackLaneId: string } => event.playbackLaneId !== undefined)
        .map((event) => [event.playbackLaneId, event.partIndex]),
    );
    this.pausedAtScoreTime = 0;
    this.hasControlEvents = timeline.events.some((e) => e.type === "programChange" || e.type === "controlChange");

    this.emit("loaded", {
      partCount: new Set(timeline.events.map((event) => event.partIndex)).size,
      duration: timeline.duration,
    });
  }

  /**
   * Inject (or clear) a tempo-model time→position inverse for the playhead.
   * The playback layer supplies this from the score's tempo model so the
   * playhead is exact through sub-bar tempo changes / rit. / fermata holds;
   * `null` restores the built-in per-bar-linear estimate. Persists across
   * {@link loadTimeline} so callers may set it in either order.
   */
  setPlayheadResolver(resolver: PlayheadResolver | null): void {
    this.playheadResolver = resolver;
  }

  /**
   * Load (or clear) a pre-scheduled metronome click track in score time. The
   * playback layer builds this from the tempo model + meter so clicks stay
   * sample-accurate through sub-bar tempo changes / rit. / fermata holds. The
   * clicks ride the note scheduler's look-ahead window; an empty array (the
   * default) plays no clicks. Persists across {@link loadTimeline}; takes
   * effect at the next play / seek (the scheduler is rebuilt then).
   */
  setClickTrack(clicks: readonly ClickEvent[]): void {
    this.clickTrack = clicks;
  }

  /**
   * Set the sink invoked for each scheduled click at its precise audio time —
   * typically `(t, accented) => metronome.scheduleClick(t, accented)`. `null`
   * disables click scheduling. Persists across {@link loadTimeline}.
   */
  setClickCallback(callback: ClickCallback | null): void {
    this.clickCallback = callback;
  }

  /** Scheduler click-track argument, or undefined when no clicks are wired. */
  private clickSchedulerArg(): { events: readonly ClickEvent[]; onClick: ClickCallback } | undefined {
    if (!this.clickCallback || this.clickTrack.length === 0) return undefined;
    return { events: this.clickTrack, onClick: this.clickCallback };
  }

  // ═══════════════════════════════════════════
  // Transport controls
  // ═══════════════════════════════════════════

  /**
   * Start or resume playback.
   *
   * @param fromSeconds - Optional score-time to start from.
   *                      If omitted, resumes from paused position or start.
   */
  play(fromSeconds?: number): void {
    if (!this.timeline) {
      this.emit("error", { message: "No timeline loaded", type: "playback" });
      return;
    }

    // If already playing, only restart if a specific position is given
    if (this.state === "playing") {
      if (fromSeconds !== undefined) {
        this.seek(fromSeconds);
      }
      return;
    }

    // Resume AudioContext if suspended (browser autoplay policy)
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume();
    }

    const startTime = fromSeconds !== undefined ? fromSeconds : this.pausedAtScoreTime;

    this.scheduler = new Scheduler(
      this.timeline.events,
      {
        scheduleAheadTime: this.options.scheduleAheadTime,
        tickIntervalMs: this.options.tickIntervalMs,
        leadInTime: this.options.leadInTime,
      },
      this.handleScheduledEvent,
      () => this.audioContext.currentTime,
      this.clickSchedulerArg(),
    );

    this.scheduler.start(startTime, this.tempoScale);
    this.applyStartingState(startTime);
    this.startPlayheadUpdates();
    this.setState("playing");
  }

  /** Pause playback, freezing the playhead position. */
  pause(): void {
    if (this.state !== "playing" || !this.scheduler) return;

    this.pausedAtScoreTime = this.scheduler.currentScoreTime();
    this.scheduler.stop();
    this.scheduler = null;
    this.stopPlayheadUpdates();
    this.silenceAll();
    this.setState("paused");
  }

  /** Stop playback and reset to the beginning. */
  stop(): void {
    const wasStopped = this.state === "stopped";

    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
    }
    this.stopPlayheadUpdates();
    this.silenceAll();
    this.pausedAtScoreTime = 0;
    if (wasStopped) return;
    this.setState("stopped");
  }

  /**
   * Seek to a specific position in seconds.
   * If playing, playback continues from the new position.
   * If paused/stopped, the position is saved for the next play().
   */
  seek(seconds: number): void {
    if (!this.timeline) return;
    const clamped = Math.max(0, Math.min(seconds, this.timeline.duration));

    if (this.state === "playing") {
      this.silenceAll();
      if (this.scheduler) {
        this.scheduler.stop();
      }

      this.scheduler = new Scheduler(
        this.timeline.events,
        {
          scheduleAheadTime: this.options.scheduleAheadTime,
          tickIntervalMs: this.options.tickIntervalMs,
          leadInTime: this.options.leadInTime,
        },
        this.handleScheduledEvent,
        () => this.audioContext.currentTime,
        this.clickSchedulerArg(),
      );
      this.scheduler.start(clamped, this.tempoScale);
      this.applyStartingState(clamped);
    } else {
      this.pausedAtScoreTime = clamped;
    }

    // Emit an immediate playhead update at the new position
    this.emit("playhead", {
      position: this.computePlayheadPosition(clamped),
    });
  }

  /**
   * Override the score tempo.
   *
   * @param bpm - Target BPM. The scale factor is derived from the first
   *              tempo map entry (original BPM). If no tempo map exists,
   *              120 BPM is assumed as the default.
   */
  setTempo(bpm: number): void {
    if (bpm <= 0) return;
    const originalBpm = this.getOriginalBpm();
    this.tempoScale = bpm / originalBpm;

    if (this.scheduler) {
      this.scheduler.setTempoScale(this.tempoScale);
    }
  }

  /** Get the current playhead position. */
  getPlayheadPosition(): PlayheadPosition {
    const scoreTime = this.getCurrentScoreTime();
    return this.computePlayheadPosition(scoreTime);
  }

  /**
   * Current score-time in seconds. Exposed so an external transport (the native
   * VST host) can align its origin to this engine when resuming from a pause,
   * where the resume position isn't passed to `play()`.
   */
  getScoreTimeSeconds(): number {
    return this.getCurrentScoreTime();
  }

  /** Get the current transport state. */
  getState(): PlaybackState {
    return this.state;
  }

  /** Get the loaded timeline (if any). */
  getTimeline(): MidiTimeline | null {
    return this.timeline;
  }

  /** Clean up resources. */
  dispose(): void {
    this.stop();
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    // Clear all listeners
    for (const key of Object.keys(this.listeners)) {
      delete this.listeners[key as keyof PlaybackEventMap];
    }
  }

  // ═══════════════════════════════════════════
  // Event emitter
  // ═══════════════════════════════════════════

  /** Subscribe to a playback event. */
  on<K extends keyof PlaybackEventMap>(event: K, callback: PlaybackEventCallback<K>): void {
    if (!this.listeners[event]) {
      (this.listeners as Record<string, Set<PlaybackEventCallback<K>>>)[event as string] = new Set();
    }
    (this.listeners[event] as Set<PlaybackEventCallback<K>>).add(callback);
  }

  /** Unsubscribe from a playback event. */
  off<K extends keyof PlaybackEventMap>(event: K, callback: PlaybackEventCallback<K>): void {
    const set = this.listeners[event] as Set<PlaybackEventCallback<K>> | undefined;
    if (set) {
      set.delete(callback);
    }
  }

  // ═══════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════

  private emit<K extends keyof PlaybackEventMap>(event: K, detail: PlaybackEventMap[K]): void {
    const set = this.listeners[event] as Set<PlaybackEventCallback<K>> | undefined;
    if (set) {
      for (const cb of set) {
        try {
          cb(detail);
        } catch {
          // Don't let listener errors crash the engine
        }
      }
    }
  }

  private setState(newState: PlaybackState): void {
    const prev = this.state;
    if (prev === newState) return;
    this.state = newState;
    this.emit("state", { state: newState, previousState: prev });
  }

  /**
   * Set a view-based part filter. When set, only events for parts in the
   * filter are played. Pass null to clear (play all parts).
   */
  setViewPartFilter(partIndices: ReadonlySet<number> | null): void {
    const prev = this.viewPartFilter;
    this.viewPartFilter = partIndices;

    // Silence parts that just became hidden
    if (partIndices && this.state === "playing") {
      for (const [partIndex, sampler] of this.partControlSamplers()) {
        if (partIndex !== undefined && !partIndices.has(partIndex) && (!prev || prev.has(partIndex))) {
          sampler.allNotesOff();
        }
      }
    }
  }

  /**
   * Apply the "sticky" MIDI state (program + control changes) that is in
   * effect at `startScoreTime` but whose events occurred earlier in the
   * timeline. The scheduler only fires events from the start point forward,
   * so without this, starting playback inside e.g. a pizz. region would play
   * arco — the technique would only take effect once the playhead crossed its
   * marking. This "chases" the most recent programChange per part and the most
   * recent value per (part, cc) at or before the start time and applies them
   * immediately, so a technique applies to its whole forward region (like how
   * a clef applies forward from where it appears).
   *
   * Every sampler is first reset to its baseline so stale state from a prior
   * playback (or a later region) doesn't leak when starting before any marking.
   */
  private applyStartingState(startScoreTime: number): void {
    if (!this.timeline || !this.hasControlEvents) return;

    // 1. Reset every part to baseline (undo stale pizz/mute from a prior run).
    for (const [, sampler] of this.partControlSamplers()) {
      sampler.resetTechniqueState?.();
    }

    // 2. Chase: collect the last programChange per part and the last value per
    //    (part, cc) at or before the start time. Events are sorted ascending.
    const lastProgram = new Map<number | string, number>();
    const lastCc = new Map<number | string, Map<number, number>>();
    for (const ev of this.timeline.events) {
      if (ev.time > startScoreTime) break;
      const routingKey = ev.playbackLaneId ?? ev.partIndex;
      if (ev.type === "programChange" && ev.program !== undefined) {
        lastProgram.set(routingKey, ev.program);
      } else if (ev.type === "controlChange" && ev.cc !== undefined && ev.value !== undefined) {
        let ccMap = lastCc.get(routingKey);
        if (!ccMap) {
          ccMap = new Map();
          lastCc.set(routingKey, ccMap);
        }
        ccMap.set(ev.cc, ev.value);
      }
    }

    // 3. Apply the chased state immediately (before any note fires).
    for (const [partIndex, program] of lastProgram) {
      this.samplers.get(partIndex)?.setProgram?.(program);
    }
    for (const [partIndex, ccMap] of lastCc) {
      const sampler = this.samplers.get(partIndex);
      if (!sampler?.sendControl) continue;
      for (const [cc, value] of ccMap) {
        sampler.sendControl(cc, value);
      }
    }
  }

  /** Route a scheduled MIDI event to the appropriate part sampler. */
  private handleScheduledEvent = (event: MidiEvent, audioTime: number): void => {
    // Skip events for parts hidden by the view filter.
    if (this.viewPartFilter && !this.viewPartFilter.has(event.partIndex)) return;

    const sampler = this.samplers.get(event.playbackLaneId ?? event.partIndex) ?? this.samplers.get(event.partIndex);
    if (!sampler) return;

    try {
      if (event.type === "noteOn") {
        sampler.noteOn(event.midiNote, event.velocity, audioTime, event.drumKitProgram);
      } else if (event.type === "programChange") {
        if (sampler.setProgram && event.program !== undefined) {
          sampler.setProgram(event.program, audioTime);
        }
      } else if (event.type === "controlChange") {
        if (sampler.sendControl && event.cc !== undefined && event.value !== undefined) {
          sampler.sendControl(event.cc, event.value, audioTime);
        }
      } else {
        sampler.noteOff(event.midiNote, audioTime, event.drumKitProgram);
      }
    } catch (err) {
      this.emit("error", {
        message: err instanceof Error ? err.message : String(err),
        type: "sampler",
      });
    }
  };

  /** Send allNotesOff to every sampler. */
  private silenceAll(): void {
    for (const [, sampler] of this.partControlSamplers()) {
      sampler.allNotesOff();
    }
  }

  /** One part-level control facade per part. Tests and standalone audio
   *  consumers may provide only lane samplers, so fall back to one unique
   *  sampler per lane-part mapping when numeric facades are absent. */
  private partControlSamplers(): ReadonlyArray<readonly [number, ISampler]> {
    const facades: Array<readonly [number, ISampler]> = [];
    for (const [key, sampler] of this.samplers) {
      if (typeof key === "number") facades.push([key, sampler]);
    }
    if (facades.length > 0) return facades;
    for (const [key, sampler] of this.samplers) {
      if (typeof key !== "string") continue;
      const partIndex = this.lanePartIndices.get(key);
      if (partIndex !== undefined) facades.push([partIndex, sampler]);
    }
    return facades;
  }

  private getCurrentScoreTime(): number {
    if (this.scheduler && this.state === "playing") {
      return this.scheduler.currentScoreTime();
    }
    return this.pausedAtScoreTime;
  }

  private getOriginalBpm(): number {
    if (this.timeline && this.timeline.tempoMap.length > 0) {
      return this.timeline.tempoMap[0]!.bpm;
    }
    return 120; // MNX default
  }

  // ─── Playhead position ──────────────────────

  /**
   * Convert score-time (seconds) to a PlayheadPosition using measure start times
   * and the tempo map.
   */
  private computePlayheadPosition(scoreTime: number): PlayheadPosition {
    // The score clock can read slightly negative during the lead-in window
    // (Scheduler.startAudioTime is offset by leadInTime) and when timing
    // humanization shifts early events before t=0. A playhead before the
    // start of the score is meaningless, so clamp to 0 — otherwise the UI
    // renders nonsense like "-1:-1" from Math.floor on a negative time.
    const t = Math.max(0, scoreTime);

    // Exact path: a tempo-model inverse (sub-bar tempo, rit./accel., fermata
    // holds) supplied by the playback layer. Falls through to the per-bar
    // linear estimate below when absent or out of range.
    if (this.playheadResolver) {
      const resolved = this.playheadResolver(t);
      if (resolved) {
        return { measureIndex: resolved.measureIndex, beat: Math.max(0, resolved.beat), timeSeconds: t };
      }
    }

    if (!this.timeline || this.timeline.tempoMap.length === 0) {
      return { measureIndex: 0, beat: 0, timeSeconds: t };
    }

    const measureStarts = this.timeline.measureStartTimes;
    const tempoMap = this.timeline.tempoMap;

    // Find which measure this time falls in using measureStartTimes
    let measureIndex = 0;
    for (let i = 0; i < measureStarts.length; i++) {
      if (measureStarts[i]! <= t) {
        measureIndex = i;
      } else {
        break;
      }
    }

    // Find the active tempo at this time
    let activeBpm = tempoMap[0]!.bpm;
    for (let i = 0; i < tempoMap.length; i++) {
      if (tempoMap[i]!.time <= t) {
        activeBpm = tempoMap[i]!.bpm;
      } else {
        break;
      }
    }

    // Calculate beat within this measure
    const measureStartTime = measureStarts[measureIndex] ?? 0;
    const secondsIntoMeasure = t - measureStartTime;
    const beatsPerSecond = activeBpm / 60;
    const beat = secondsIntoMeasure * beatsPerSecond;

    return {
      measureIndex,
      beat: Math.max(0, beat),
      timeSeconds: t,
    };
  }

  // ─── Playhead update loop ──────────────────

  private startPlayheadUpdates(): void {
    this.stopPlayheadUpdates();
    const tick = (): void => {
      if (this.state !== "playing") return;

      const scoreTime = this.getCurrentScoreTime();

      // Auto-stop at end of timeline
      if (this.timeline && scoreTime >= this.timeline.duration) {
        this.stop();
        return;
      }

      this.emit("playhead", {
        position: this.computePlayheadPosition(scoreTime),
      });
      this.playheadTimerId = setTimeout(tick, this.options.playheadIntervalMs);
    };
    this.playheadTimerId = setTimeout(tick, this.options.playheadIntervalMs);
  }

  private stopPlayheadUpdates(): void {
    if (this.playheadTimerId !== null) {
      clearTimeout(this.playheadTimerId);
      this.playheadTimerId = null;
    }
  }
}
