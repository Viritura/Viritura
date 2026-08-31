/**
 * Fake `<video>` element and transport used by the synchronizer tests.
 *
 * Modelling the media element rather than using jsdom keeps the tests honest
 * about the one behaviour that matters here: *every* state change emits an
 * event, whether the app caused it or the user did via the PiP window's own
 * controls. That symmetry is exactly what the synchronizer's guards have to
 * cope with, so the fake reproduces it faithfully.
 */

import type { SyncedVideoElement, TransportBridge, TransportStatus } from "../types";

export class FakeVideoElement implements SyncedVideoElement {
  currentTime = 0;
  playbackRate = 1;
  muted = false;
  readyState = 4;
  seeking = false;
  src = "";
  error: MediaError | null = null;
  ended = false;

  private pausedState = true;
  private readonly handlers = new Map<string, ((event: Event) => void)[]>();

  get paused(): boolean {
    return this.pausedState;
  }

  duration = 600;

  /** Matches `HTMLMediaElement.load()`; the fake has nothing to fetch. */
  load(): void {}

  /** Matches `Element.removeAttribute`, used when detaching the source. */
  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }

  /**
   * Reproduce end-of-media exactly as the HTML spec describes it: the element
   * pauses *itself* and fires `pause` before `ended`. Distinguishing that pause
   * from a user pressing pause in the PiP window is the whole reason the
   * synchronizer consults `ended`.
   */
  reachEnd(): void {
    this.currentTime = this.duration;
    this.ended = true;
    if (!this.pausedState) {
      this.pausedState = true;
      this.emit("pause");
    }
    this.emit("ended");
  }

  async play(): Promise<void> {
    if (!this.pausedState) return;
    this.pausedState = false;
    this.ended = false;
    this.emit("play");
  }

  pause(): void {
    if (this.pausedState) return;
    this.pausedState = true;
    this.emit("pause");
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(listener);
    this.handlers.set(type, list);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    const list = this.handlers.get(type);
    if (!list) return;
    this.handlers.set(
      type,
      list.filter((entry) => entry !== listener),
    );
  }

  /** Emit an event exactly as the browser would. */
  emit(type: string): void {
    for (const handler of [...(this.handlers.get(type) ?? [])]) {
      handler({ type } as Event);
    }
  }

  /** Simulate the user pressing play in the PiP window. */
  userPressPlay(): void {
    this.pausedState = false;
    this.emit("play");
  }

  /** Simulate the user pressing pause in the PiP window. */
  userPressPause(): void {
    this.pausedState = true;
    this.emit("pause");
  }

  /** Simulate the user scrubbing in the PiP window. */
  userScrubTo(seconds: number): void {
    this.currentTime = seconds;
    this.emit("seeked");
  }

  /** Acknowledge an app-issued seek the way a browser does after decoding. */
  completeSeek(): void {
    this.emit("seeked");
  }
}

export class FakeTransport implements TransportBridge {
  scoreTime = 0;
  status: TransportStatus = "stopped";

  readonly calls: { type: "play" | "pause" | "seek"; value?: number }[] = [];

  getScoreTimeSeconds(): number {
    return this.scoreTime;
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  play(fromSeconds?: number): void {
    this.calls.push({ type: "play", value: fromSeconds });
    if (fromSeconds !== undefined) this.scoreTime = fromSeconds;
    this.status = "playing";
  }

  pause(): void {
    this.calls.push({ type: "pause" });
    this.status = "paused";
  }

  seekSeconds(seconds: number): void {
    this.calls.push({ type: "seek", value: seconds });
    this.scoreTime = seconds;
  }
}

/** Scheduler that only advances when the test says so. */
export class ManualScheduler {
  private tickFn: (() => void) | null = null;

  start(tick: () => void): void {
    this.tickFn = tick;
  }

  stop(): void {
    this.tickFn = null;
  }

  /** Run the synchronizer's follow loop `count` times. */
  advance(count = 1): void {
    for (let i = 0; i < count; i++) this.tickFn?.();
  }

  get running(): boolean {
    return this.tickFn !== null;
  }
}
