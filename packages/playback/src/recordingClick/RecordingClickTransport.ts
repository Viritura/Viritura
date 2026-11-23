import { ClickEngine, type ClickEngineEvent, type ClickStartReceipt } from "@viritura/audio";
import type { RecordingClickProgram } from "./recordingClickProgram";

/** The click-engine surface the transport drives (a {@link ClickEngine} in production). */
export type RecordingClickEngine = Pick<ClickEngine, "load" | "start" | "stop" | "dispose" | "onEvent">;

export interface RecordingClickTransportOptions {
  /** Tears down score playback (samplers, synths, native hosts) so only the click runs. */
  readonly releaseScoreAudio: () => Promise<void>;
  readonly createEngine?: () => Promise<RecordingClickEngine>;
  readonly onEvent?: (event: ClickEngineEvent) => void;
}

export type RecordingClickStatus = "idle" | "ready" | "playing" | "paused";

/**
 * Click-only transport for recording sessions. Preparing a program first
 * releases every score-playback resource, then hands the complete program to a
 * dedicated click engine. Play always restarts with the countoff; Resume
 * continues from the paused position without one.
 */
export class RecordingClickTransport {
  private engine: RecordingClickEngine | undefined;
  private unsubscribe: (() => void) | undefined;
  private pausedAt = 0;
  private currentStatus: RecordingClickStatus = "idle";

  constructor(private readonly options: RecordingClickTransportOptions) {}

  get status(): RecordingClickStatus {
    return this.currentStatus;
  }

  async prepare(program: RecordingClickProgram): Promise<void> {
    if (this.engine && this.currentStatus === "playing") await this.engine.stop();
    await this.options.releaseScoreAudio();
    const engine = await this.ensureEngine();
    await engine.load(program.events);
    this.pausedAt = 0;
    this.currentStatus = "ready";
  }

  async play(): Promise<ClickStartReceipt> {
    const engine = this.requireEngine();
    if (this.currentStatus === "playing") await engine.stop();
    const receipt = await engine.start(0);
    this.currentStatus = "playing";
    return receipt;
  }

  async pause(): Promise<void> {
    if (this.currentStatus !== "playing") return;
    this.pausedAt = await this.requireEngine().stop();
    this.currentStatus = "paused";
  }

  async resume(): Promise<ClickStartReceipt> {
    if (this.currentStatus !== "paused") throw new Error("Only a paused click can resume");
    const receipt = await this.requireEngine().start(this.pausedAt);
    this.currentStatus = "playing";
    return receipt;
  }

  async stop(): Promise<void> {
    if (this.currentStatus === "playing") await this.requireEngine().stop();
    this.pausedAt = 0;
    if (this.currentStatus !== "idle") this.currentStatus = "ready";
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    const engine = this.engine;
    this.engine = undefined;
    this.currentStatus = "idle";
    await engine?.dispose();
  }

  private async ensureEngine(): Promise<RecordingClickEngine> {
    if (!this.engine) {
      const engine = await (this.options.createEngine ?? (() => ClickEngine.create()))();
      this.engine = engine;
      this.unsubscribe = engine.onEvent((event) => {
        if (event.type === "ended" && this.currentStatus === "playing") this.currentStatus = "ready";
        this.options.onEvent?.(event);
      });
    }
    return this.engine;
  }

  private requireEngine(): RecordingClickEngine {
    if (!this.engine || this.currentStatus === "idle") throw new Error("Prepare a click program first");
    return this.engine;
  }
}
