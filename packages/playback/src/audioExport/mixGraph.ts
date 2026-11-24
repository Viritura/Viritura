import {
  PartitionedConvolver,
  REVERB_RETURN_HIGHPASS,
  REVERB_SEND_INPUT_GAIN,
  StereoBiquad,
  StereoCompressor,
  StereoDelay,
  decodeWav,
  resampleChannels,
} from "@viritura/audio";
import { DEFAULT_VOLUME } from "../playbackReducer";
import {
  AIR_EQ_FREQUENCY,
  EQ_COLOR_BUS_FILTERS,
  LIMITER_ATTACK_SECONDS,
  LIMITER_KNEE_DB,
  LIMITER_RELEASE_SECONDS,
} from "../mixChain";
import type { AudioEffects } from "./messages";
import type { StageSection } from "./stagePlan";

/** Extra render time after the last voice for the synth's own effects to ring out. */
const EFFECTS_TAIL_SECONDS = 3;

interface StereoBuffer {
  left: Float32Array;
  right: Float32Array;
}

function stereo(size: number): StereoBuffer {
  return { left: new Float32Array(size), right: new Float32Array(size) };
}

function addScaled(target: StereoBuffer, source: StereoBuffer, gain: number, size: number): void {
  for (let i = 0; i < size; i++) {
    target.left[i] = target.left[i]! + source.left[i]! * gain;
    target.right[i] = target.right[i]! + source.right[i]! * gain;
  }
}

function scale(buffer: StereoBuffer, gain: number, size: number): void {
  for (let i = 0; i < size; i++) {
    buffer.left[i] = buffer.left[i]! * gain;
    buffer.right[i] = buffer.right[i]! * gain;
  }
}

interface ReverbReturn {
  convolver: PartitionedConvolver;
  wet: number;
  highpass: StereoBiquad;
  predelays: StereoDelay[];
  input: StereoBuffer;
  output: StereoBuffer;
  send: StereoBuffer;
}

function createReverb(
  reverb: NonNullable<AudioEffects["reverb"]>,
  sections: readonly StageSection[],
  sampleRate: number,
  blockSize: number,
): ReverbReturn {
  const decoded = decodeWav(reverb.impulse);
  const channels = resampleChannels(decoded.channels, decoded.sampleRate, sampleRate);
  return {
    convolver: new PartitionedConvolver({ channels }, sampleRate, blockSize),
    wet: Math.max(0, Math.min(1, reverb.wet)),
    highpass: new StereoBiquad(REVERB_RETURN_HIGHPASS, sampleRate),
    predelays: sections.map((section) => new StereoDelay(section.predelaySeconds, sampleRate)),
    input: stereo(blockSize),
    output: stereo(blockSize),
    send: stereo(blockSize),
  };
}

/**
 * The playback mix graph as offline DSP: section bus gain, EQ color buses,
 * pre-delayed convolution reverb sends, then the master air EQ and limiter.
 * Without `effects` only the dry section and EQ routing is applied.
 */
export class OfflineMixGraph {
  /** Per-section synth output, cleared by `render`. */
  readonly sections: StereoBuffer[];
  readonly output: StereoBuffer;
  /** Frames to keep rendering after the last voice so effects can decay. */
  readonly tailFrames: number;
  private readonly buses: { buffer: StereoBuffer; filters: StereoBiquad[] }[];
  private readonly reverb: ReverbReturn | null;
  private readonly master: { airEq: StereoBiquad; limiter: StereoCompressor } | null;

  constructor(
    private readonly plan: readonly StageSection[],
    effects: AudioEffects | undefined,
    sampleRate: number,
    readonly blockSize: number,
  ) {
    this.sections = plan.map(() => stereo(blockSize));
    this.output = stereo(blockSize);
    this.buses = EQ_COLOR_BUS_FILTERS.map((specs) => ({
      buffer: stereo(blockSize),
      filters: specs.map((spec) => new StereoBiquad(spec, sampleRate)),
    }));
    this.reverb = effects?.reverb ? createReverb(effects.reverb, plan, sampleRate, blockSize) : null;
    this.master = effects
      ? {
          airEq: new StereoBiquad(
            { type: "highshelf", frequency: AIR_EQ_FREQUENCY, gain: effects.airEqGainDb },
            sampleRate,
          ),
          limiter: new StereoCompressor(
            {
              thresholdDb: effects.limiterThresholdDb,
              ratio: effects.limiterRatio,
              kneeDb: LIMITER_KNEE_DB,
              attack: LIMITER_ATTACK_SECONDS,
              release: LIMITER_RELEASE_SECONDS,
            },
            sampleRate,
          ),
        }
      : null;
    this.tailFrames = effects
      ? Math.ceil(EFFECTS_TAIL_SECONDS * sampleRate) + (this.reverb?.convolver.tailFrames ?? 0)
      : 0;
  }

  /** Mixes one block of section audio into `output`, clamped to [-1, 1], and clears the section buffers. */
  render(): void {
    const size = this.blockSize;
    for (const bus of this.buses) {
      bus.buffer.left.fill(0);
      bus.buffer.right.fill(0);
    }
    const reverb = this.reverb;
    if (reverb) {
      reverb.input.left.fill(0);
      reverb.input.right.fill(0);
    }
    this.plan.forEach((section, index) => {
      const buffer = this.sections[index]!;
      scale(buffer, section.gain, size);
      addScaled(this.buses[section.eqBus]!.buffer, buffer, 1, size);
      if (reverb) {
        reverb.send.left.set(buffer.left);
        reverb.send.right.set(buffer.right);
        reverb.predelays[index]!.process(reverb.send.left, reverb.send.right);
        addScaled(reverb.input, reverb.send, section.reverbSend, size);
      }
      buffer.left.fill(0);
      buffer.right.fill(0);
    });

    const out = this.output;
    out.left.fill(0);
    out.right.fill(0);
    for (const bus of this.buses) {
      for (const filter of bus.filters) filter.process(bus.buffer.left, bus.buffer.right);
      addScaled(out, bus.buffer, 1, size);
    }
    if (reverb) {
      scale(reverb.input, REVERB_SEND_INPUT_GAIN, size);
      reverb.convolver.process(reverb.input.left, reverb.input.right, reverb.output.left, reverb.output.right);
      reverb.highpass.process(reverb.output.left, reverb.output.right);
      addScaled(out, reverb.output, reverb.wet, size);
    }
    if (this.master) {
      scale(out, DEFAULT_VOLUME, size);
      this.master.airEq.process(out.left, out.right);
      this.master.limiter.process(out.left, out.right);
    }
    for (let i = 0; i < size; i++) {
      out.left[i] = Math.max(-1, Math.min(1, out.left[i]!));
      out.right[i] = Math.max(-1, Math.min(1, out.right[i]!));
    }
  }
}
