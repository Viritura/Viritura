import { compileClickProgram, type ClickProgramEvent } from "./clickProgram";
import { CLICK_PROCESSOR_NAME } from "./workletSource";
import { CLICK_SOUNDS, isClickSound, synthesizeClickVoices, type ClickSound } from "../clickSound";

export type ClickEngineErrorCode =
  "worklet-load" | "invalid-program" | "invalid-sound" | "no-program" | "busy" | "late-start" | "timeout" | "disposed";

/** A click-engine failure. Recording clicks fail loudly; they never fall back to a lower-precision path. */
export class ClickEngineError extends Error {
  readonly code: ClickEngineErrorCode;

  constructor(code: ClickEngineErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ClickEngineError";
    this.code = code;
  }
}

/** Notifications from the audio thread. */
export type ClickEngineEvent =
  | { readonly type: "started"; readonly contextTime: number }
  | { readonly type: "ended" }
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "missed"; readonly count: number };

export interface ClickStartReceipt {
  /** AudioContext time at which program time `fromSeconds` sounds. */
  readonly contextTime: number;
}

export interface ClickEngineOptions {
  /** Staged worklet URL. Defaults to `<BASE_URL>sounds/viritura-click-processor.js`. */
  readonly workletUrl?: string;
  /** Creates the engine's private AudioContext. Tests inject a fake device. */
  readonly createContext?: () => AudioContext;
  /** Milliseconds to wait for an audio-thread acknowledgement. */
  readonly ackTimeoutMs?: number;
}

/** Default gap between arming and the first rendered frame; covers message latency. */
export const DEFAULT_CLICK_START_LEAD_SECONDS = 0.15;
const DEFAULT_ACK_TIMEOUT_MS = 2000;

interface WorkletReply {
  readonly type: string;
  readonly requestId?: number;
  readonly code?: ClickEngineErrorCode;
  readonly count?: number;
  readonly atFrame?: number;
  readonly programFrame?: number;
}

interface PendingRequest {
  resolve(reply: WorkletReply): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function defaultWorkletUrl(): string {
  const baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  return `${baseUrl}sounds/viritura-click-processor.js`;
}

/**
 * Click-only recording engine. It runs a dedicated AudioContext whose render
 * graph holds nothing but the click worklet, so no instrument DSP, reverb, or
 * main-thread timer can delay a click. The full program is transferred to the
 * audio thread up front and every onset is sample-addressed there.
 */
export class ClickEngine {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<(event: ClickEngineEvent) => void>();
  private nextRequestId = 1;
  private disposed = false;

  private constructor(
    readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
    private readonly ackTimeoutMs: number,
  ) {
    node.port.onmessage = (event: MessageEvent<WorkletReply>) => this.receive(event.data);
    node.onprocessorerror = () => {
      const event: ClickEngineEvent = { type: "failed", message: "The click audio processor failed" };
      for (const listener of this.listeners) listener(event);
    };
    node.connect(context.destination);
  }

  static async create(options: ClickEngineOptions = {}): Promise<ClickEngine> {
    const context = options.createContext?.() ?? new AudioContext({ latencyHint: "interactive" });
    const workletUrl = options.workletUrl ?? defaultWorkletUrl();
    try {
      await context.audioWorklet.addModule(workletUrl);
    } catch (error) {
      void context.close();
      throw new ClickEngineError(
        "worklet-load",
        `Failed to load ${workletUrl}: ${error instanceof Error ? error.message : String(error)}. ` +
          "Check that the staged click worklet is deployed and permitted by the Content Security Policy.",
        { cause: error },
      );
    }
    try {
      const voices = CLICK_SOUNDS.map((sound) => synthesizeClickVoices(context.sampleRate, sound));
      const node = new AudioWorkletNode(context, CLICK_PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { voices },
      });
      return new ClickEngine(context, node, options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS);
    } catch (error) {
      void context.close();
      throw new ClickEngineError(
        "worklet-load",
        `Failed to initialize the click processor: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  onEvent(listener: (event: ClickEngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Transfer a complete click program to the audio thread; resolves once it is resident there. */
  async load(events: readonly ClickProgramEvent[], duration?: number): Promise<number> {
    const program = compileClickProgram(events, this.sampleRate);
    if (duration !== undefined && (!Number.isFinite(duration) || duration < (events.at(-1)?.time ?? 0))) {
      throw new RangeError("Click duration must be finite and include every click");
    }
    const endFrame = duration === undefined ? 0 : Math.round(duration * this.sampleRate);
    const reply = await this.request({ type: "load", frames: program.frames, levels: program.levels, endFrame }, [
      program.frames.buffer,
      program.levels.buffer,
    ]);
    return reply.count ?? 0;
  }

  /**
   * Arm playback so program time `fromSeconds` sounds `leadSeconds` from now.
   * Resolves once the audio thread has accepted the anchor.
   */
  async start(fromSeconds = 0, leadSeconds = DEFAULT_CLICK_START_LEAD_SECONDS): Promise<ClickStartReceipt> {
    if (!Number.isFinite(fromSeconds) || fromSeconds < 0) throw new RangeError("Click start must be non-negative");
    if (this.context.state !== "running") await this.context.resume();
    const currentFrame = Math.round(this.context.currentTime * this.sampleRate);
    const atFrame = currentFrame + Math.ceil(leadSeconds * this.sampleRate - 1e-9);
    const reply = await this.request({
      type: "start",
      atFrame,
      offsetFrame: Math.round(fromSeconds * this.sampleRate),
    });
    return { contextTime: (reply.atFrame ?? atFrame) / this.sampleRate };
  }

  /** Silence clicks immediately. Resolves with the program time (seconds) reached, for resuming. */
  async stop(): Promise<number> {
    const reply = await this.request({ type: "stop" });
    return (reply.programFrame ?? 0) / this.sampleRate;
  }

  /** Change future clicks without changing their scheduled frames. */
  async setSound(sound: ClickSound): Promise<void> {
    if (!isClickSound(sound)) throw new RangeError(`Unknown click sound: ${String(sound)}`);
    await this.request({ type: "sound", sound });
  }

  setGain(gain: number): void {
    this.node.port.postMessage({ type: "gain", gain });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(new ClickEngineError("disposed", "The click engine was disposed"));
    }
    this.pending.clear();
    this.listeners.clear();
    this.node.port.onmessage = null;
    this.node.disconnect();
    if (this.context.state !== "closed") await this.context.close();
  }

  private request(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<WorkletReply> {
    if (this.disposed) return Promise.reject(new ClickEngineError("disposed", "The click engine was disposed"));
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new ClickEngineError("timeout", `The click audio thread did not acknowledge "${String(message.type)}"`));
      }, this.ackTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.node.port.postMessage({ ...message, requestId }, transfer);
    });
  }

  private receive(reply: WorkletReply): void {
    if (reply.requestId !== undefined) {
      const request = this.pending.get(reply.requestId);
      if (!request) return;
      this.pending.delete(reply.requestId);
      clearTimeout(request.timer);
      if (reply.type === "error") {
        request.reject(new ClickEngineError(reply.code ?? "invalid-program", clickErrorMessage(reply.code)));
      } else request.resolve(reply);
      return;
    }
    let event: ClickEngineEvent | undefined;
    if (reply.type === "started") event = { type: "started", contextTime: (reply.atFrame ?? 0) / this.sampleRate };
    else if (reply.type === "ended") event = { type: "ended" };
    else if (reply.type === "missed") event = { type: "missed", count: reply.count ?? 0 };
    if (event) for (const listener of this.listeners) listener(event);
  }
}

function clickErrorMessage(code: ClickEngineErrorCode | undefined): string {
  switch (code) {
    case "busy":
      return "Stop the click before loading another program";
    case "no-program":
      return "Load a click program before starting";
    case "late-start":
      return "The click start time had already passed; the take was not started";
    case "invalid-sound":
      return "The click audio thread rejected the selected sound";
    default:
      return "The click audio thread rejected the program";
  }
}
