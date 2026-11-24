import { Fft } from "./fft";

/** Impulse response channels at the render sample rate. */
export interface ImpulseResponse {
  channels: Float32Array[];
}

const MIN_POWER = 0.000125;
const GAIN_CALIBRATION = 0.00125;
const GAIN_CALIBRATION_SAMPLE_RATE = 44100;

/** The `ConvolverNode` normalization scale (Web Audio spec). */
export function convolverNormalizationScale(ir: ImpulseResponse, sampleRate: number): number {
  const length = ir.channels[0]?.length ?? 0;
  if (length === 0) return 1;
  let sum = 0;
  for (const channel of ir.channels) {
    for (let i = 0; i < length; i++) sum += channel[i]! * channel[i]!;
  }
  const power = Math.max(MIN_POWER, Math.sqrt(sum / (ir.channels.length * length)));
  let scale = (1 / power) * GAIN_CALIBRATION * (GAIN_CALIBRATION_SAMPLE_RATE / sampleRate);
  if (ir.channels.length === 4) scale *= 0.5;
  return scale;
}

/**
 * Uniformly partitioned overlap-save stereo convolver matching a normalized
 * `ConvolverNode`: the left input feeds IR channel 0 and the right input feeds
 * IR channel 1 (or channel 0 for a mono IR). Processes exactly `blockSize`
 * frames per call with no added latency.
 */
export class PartitionedConvolver {
  readonly blockSize: number;
  /** Number of frames the response rings after its last input. */
  readonly tailFrames: number;
  private readonly fft: Fft;
  private readonly bins: number;
  private readonly partitions: number;
  // Half spectra (bins 0..N/2) per partition, interleaved re/im.
  private readonly irLeft: Float64Array[];
  private readonly irRight: Float64Array[];
  private readonly inLeft: Float64Array[];
  private readonly inRight: Float64Array[];
  private cursor = 0;
  private readonly prevLeft: Float64Array;
  private readonly prevRight: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly accLeft: Float64Array;
  private readonly accRight: Float64Array;

  constructor(ir: ImpulseResponse, sampleRate: number, blockSize = 4096) {
    this.blockSize = blockSize;
    const n = blockSize * 2;
    this.fft = new Fft(n);
    this.bins = blockSize + 1;
    const length = ir.channels[0]?.length ?? 0;
    this.tailFrames = length;
    this.partitions = Math.max(1, Math.ceil(length / blockSize));
    const scale = convolverNormalizationScale(ir, sampleRate);
    const left = ir.channels[0] ?? new Float32Array(0);
    const right = ir.channels[1] ?? left;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.irLeft = [];
    this.irRight = [];
    this.inLeft = [];
    this.inRight = [];
    for (let p = 0; p < this.partitions; p++) {
      const [l, r] = this.spectra(left, right, p * blockSize, scale);
      this.irLeft.push(l);
      this.irRight.push(r);
      this.inLeft.push(new Float64Array(this.bins * 2));
      this.inRight.push(new Float64Array(this.bins * 2));
    }
    this.prevLeft = new Float64Array(blockSize);
    this.prevRight = new Float64Array(blockSize);
    this.accLeft = new Float64Array(this.bins * 2);
    this.accRight = new Float64Array(this.bins * 2);
  }

  /** Reads `blockSize` frames from the inputs and writes the wet signal to the outputs. */
  process(inLeft: Float32Array, inRight: Float32Array, outLeft: Float32Array, outRight: Float32Array): void {
    const b = this.blockSize;
    const { re, im } = this;
    for (let i = 0; i < b; i++) {
      re[i] = this.prevLeft[i]!;
      im[i] = this.prevRight[i]!;
      re[b + i] = inLeft[i]!;
      im[b + i] = inRight[i]!;
      this.prevLeft[i] = inLeft[i]!;
      this.prevRight[i] = inRight[i]!;
    }
    this.fft.transform(re, im);
    this.cursor = (this.cursor + this.partitions - 1) % this.partitions;
    this.splitInto(this.inLeft[this.cursor]!, this.inRight[this.cursor]!);

    const accL = this.accLeft;
    const accR = this.accRight;
    accL.fill(0);
    accR.fill(0);
    for (let p = 0; p < this.partitions; p++) {
      const slot = (this.cursor + p) % this.partitions;
      multiplyAccumulate(accL, this.inLeft[slot]!, this.irLeft[p]!);
      multiplyAccumulate(accR, this.inRight[slot]!, this.irRight[p]!);
    }

    // Y = A + iB, with A and B the Hermitian spectra of the two real outputs.
    const n = b * 2;
    for (let k = 0; k <= b; k++) {
      const ar = accL[k * 2]!;
      const ai = accL[k * 2 + 1]!;
      const br = accR[k * 2]!;
      const bi = accR[k * 2 + 1]!;
      re[k] = ar - bi;
      im[k] = ai + br;
      if (k > 0 && k < b) {
        re[n - k] = ar + bi;
        im[n - k] = -ai + br;
      }
    }
    this.fft.transform(re, im, true);
    for (let i = 0; i < b; i++) {
      outLeft[i] = re[b + i]!;
      outRight[i] = im[b + i]!;
    }
  }

  private spectra(
    left: Float32Array,
    right: Float32Array,
    offset: number,
    scale: number,
  ): [Float64Array, Float64Array] {
    const { re, im } = this;
    re.fill(0);
    im.fill(0);
    const end = Math.min(left.length, offset + this.blockSize);
    for (let i = offset; i < end; i++) {
      re[i - offset] = left[i]! * scale;
      im[i - offset] = (right[i] ?? 0) * scale;
    }
    this.fft.transform(re, im);
    const l = new Float64Array(this.bins * 2);
    const r = new Float64Array(this.bins * 2);
    this.splitInto(l, r);
    return [l, r];
  }

  /** Separates the spectra of two real signals packed as `x + iy`. */
  private splitInto(left: Float64Array, right: Float64Array): void {
    const n = this.blockSize * 2;
    const { re, im } = this;
    for (let k = 0; k < this.bins; k++) {
      const j = (n - k) % n;
      left[k * 2] = (re[k]! + re[j]!) / 2;
      left[k * 2 + 1] = (im[k]! - im[j]!) / 2;
      right[k * 2] = (im[k]! + im[j]!) / 2;
      right[k * 2 + 1] = (re[j]! - re[k]!) / 2;
    }
  }
}

function multiplyAccumulate(acc: Float64Array, x: Float64Array, h: Float64Array): void {
  for (let i = 0; i < acc.length; i += 2) {
    const xr = x[i]!;
    const xi = x[i + 1]!;
    const hr = h[i]!;
    const hi = h[i + 1]!;
    acc[i] = acc[i]! + xr * hr - xi * hi;
    acc[i + 1] = acc[i + 1]! + xr * hi + xi * hr;
  }
}
