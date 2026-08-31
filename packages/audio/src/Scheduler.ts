import type { MidiEvent, ScheduleCallback, SchedulerConfig, ClickEvent, ClickCallback } from "./types";

/**
 * Windowed MIDI event scheduler.
 *
 * Uses a look-ahead pattern (setTimeout every ~25 ms) to pre-schedule
 * MIDI events into the Web Audio timeline. The schedule window extends
 * `scheduleAheadTime` seconds beyond `audioContext.currentTime`, ensuring
 * glitch-free playback even when the JS thread is briefly blocked.
 *
 * setTimeout is used instead of requestAnimationFrame so scheduling
 * continues when the browser tab is hidden.
 *
 * A metronome click track (sorted {@link ClickEvent}[] in score time) rides
 * the same window so clicks are pre-scheduled sample-accurately on the audio
 * clock, sharing the note scheduler's seek / tempo-scale / background-tab
 * handling for free.
 *
 * Reference: Chris Wilson — "A Tale of Two Clocks"
 * https://www.html5rocks.com/en/tutorials/audio/scheduling/
 */
export class Scheduler {
  private readonly config: SchedulerConfig;
  private readonly events: readonly MidiEvent[];
  private readonly onSchedule: ScheduleCallback;
  private readonly getAudioTime: () => number;
  /** Sorted metronome click track in score time (empty when no click track). */
  private readonly clicks: readonly ClickEvent[];
  private readonly onClick: ClickCallback | null;

  /** Index into `events` — next event not yet scheduled. */
  private nextEventIndex = 0;
  /** Index into `clicks` — next click not yet scheduled. */
  private nextClickIndex = 0;
  /** Score-time (seconds) up to which we have scheduled. */
  private scheduledUpTo = 0;
  /** Audio-context time at which playback started (adjusted for seek). */
  private startAudioTime = 0;
  /** Score-time offset corresponding to the seek position. */
  private startScoreTime = 0;
  /** Tempo scaling factor (1.0 = original tempo). */
  private tempoScale = 1;

  private timerId: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    events: readonly MidiEvent[],
    config: SchedulerConfig,
    onSchedule: ScheduleCallback,
    getAudioTime: () => number,
    clickTrack?: { readonly events: readonly ClickEvent[]; readonly onClick: ClickCallback },
  ) {
    this.events = events;
    this.config = config;
    this.onSchedule = onSchedule;
    this.getAudioTime = getAudioTime;
    this.clicks = clickTrack?.events ?? [];
    this.onClick = clickTrack?.onClick ?? null;
  }

  /** Start the look-ahead loop. */
  start(fromScoreTime = 0, tempoScale = 1): void {
    if (this.running) return;
    this.running = true;
    this.tempoScale = tempoScale;
    this.startScoreTime = fromScoreTime;
    this.scheduledUpTo = fromScoreTime;
    // Pre-roll: anchor startAudioTime slightly in the future so events at
    // exactly `fromScoreTime` (e.g. the downbeat) land in the worklet's
    // schedule queue with positive lead time, instead of racing the next
    // audio quantum. Without this, simultaneous events on different
    // per-section synth instances can land on different quanta and produce
    // an audible flam on the first beat.
    const leadIn = Math.max(0, this.config.leadInTime ?? 0);
    this.startAudioTime = this.getAudioTime() + leadIn;
    this.nextEventIndex = this.findEventIndex(fromScoreTime);
    this.nextClickIndex = this.findClickIndex(fromScoreTime);
    this.tick();
  }

  /** Stop scheduling and cancel the timer. */
  stop(): void {
    this.running = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /** Update the tempo scale factor (1.0 = original). */
  setTempoScale(scale: number): void {
    if (scale <= 0) return;
    // Recalculate start references to avoid a time jump
    const currentScoreTime = this.currentScoreTime();
    this.tempoScale = scale;
    this.startScoreTime = currentScoreTime;
    this.startAudioTime = this.getAudioTime();
    this.scheduledUpTo = currentScoreTime;
    this.nextEventIndex = this.findEventIndex(currentScoreTime);
    this.nextClickIndex = this.findClickIndex(currentScoreTime);
  }

  /** Get the current score-time (seconds) based on audioContext.currentTime. */
  currentScoreTime(): number {
    const elapsed = this.getAudioTime() - this.startAudioTime;
    return this.startScoreTime + elapsed * this.tempoScale;
  }

  /** Force an immediate look-ahead tick. Use after the tab returns from
   *  being backgrounded — setTimeout is throttled to ~1 Hz in hidden tabs,
   *  so without this we'd wait up to a second for the next scheduled tick. */
  tickNow(): void {
    if (!this.running) return;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.tick();
  }

  /** Whether the scheduler is actively running. */
  get isRunning(): boolean {
    return this.running;
  }

  // ─── Private ───────────────────────────────

  private tick = (): void => {
    if (!this.running) return;

    const now = this.getAudioTime();
    const currentScoreTime = this.startScoreTime + (now - this.startAudioTime) * this.tempoScale;
    const windowEnd = currentScoreTime + this.config.scheduleAheadTime * this.tempoScale;

    this.scheduleWindow(windowEnd, now);
    this.scheduleClicks(windowEnd, now);

    this.timerId = setTimeout(this.tick, this.config.tickIntervalMs);
  };

  /**
   * Schedule all events in [scheduledUpTo, windowEnd).
   * Converts score-time to audio-time and invokes the callback.
   *
   * Past-event handling: if a tick wakes up late (background tab
   * throttling can defer ticks for up to ~1 s), events may have a
   * computed audioTime < audioNow. We MUST still fire `noteOff` events in
   * that case — dropping them strands the corresponding voices in the
   * synth and they ring forever. Same for `programChange` (state changes
   * must apply). Past `noteOn` events more than a small threshold late
   * are skipped so resuming from background doesn't produce a sudden
   * catch-up blast of harmony.
   */
  private scheduleWindow(windowEnd: number, audioNow: number): void {
    // Notes that are stale by more than this are skipped (for noteOn).
    // noteOff / programChange always fire regardless.
    const STALE_NOTEON_THRESHOLD = 0.05; // 50 ms
    while (this.nextEventIndex < this.events.length) {
      const event = this.events[this.nextEventIndex]!;
      if (event.time >= windowEnd) break;
      if (event.time < this.scheduledUpTo) {
        // Already scheduled in a previous window
        this.nextEventIndex++;
        continue;
      }

      // Convert score-time → audio-time
      const scoreTimeDelta = event.time - this.startScoreTime;
      const audioTime = this.startAudioTime + scoreTimeDelta / this.tempoScale;

      if (audioTime >= audioNow) {
        // Future event — schedule normally.
        this.onSchedule(event, audioTime);
      } else {
        // Past event — must handle differently depending on type:
        //   noteOff:       always fire (clamped to now) so voices release.
        //   programChange: always fire (state must apply).
        //   noteOn:        only fire if mildly late; otherwise drop to
        //                  avoid a catch-up blast when resuming from a
        //                  background tab.
        const lateness = audioNow - audioTime;
        const shouldFire = event.type !== "noteOn" || lateness <= STALE_NOTEON_THRESHOLD;
        if (shouldFire) {
          this.onSchedule(event, audioNow);
        }
      }

      this.nextEventIndex++;
    }
    this.scheduledUpTo = windowEnd;
  }

  /**
   * Schedule metronome clicks whose score time falls before `windowEnd`,
   * converting to audio time via the same anchor/tempo math as notes.
   *
   * A click that has already passed (audioTime < audioNow) is dropped rather
   * than crammed to "now": an off-grid click is worse than a missed one, and
   * after a seek / background-tab stall the look-ahead would otherwise emit a
   * burst of catch-up clicks. On a normal tick the look-ahead guarantees
   * audioTime ≥ audioNow, so clicks land sample-accurately on the grid.
   */
  private scheduleClicks(windowEnd: number, audioNow: number): void {
    if (!this.onClick) return;
    while (this.nextClickIndex < this.clicks.length) {
      const click = this.clicks[this.nextClickIndex]!;
      if (click.time >= windowEnd) break;

      const scoreTimeDelta = click.time - this.startScoreTime;
      const audioTime = this.startAudioTime + scoreTimeDelta / this.tempoScale;
      if (audioTime >= audioNow) {
        this.onClick(audioTime, click.accented);
      }
      this.nextClickIndex++;
    }
  }

  /** Binary search to find the first event at or after `scoreTime`. */
  private findEventIndex(scoreTime: number): number {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.events[mid]!.time < scoreTime) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** Binary search to find the first click at or after `scoreTime`. */
  private findClickIndex(scoreTime: number): number {
    let lo = 0;
    let hi = this.clicks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.clicks[mid]!.time < scoreTime) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}
