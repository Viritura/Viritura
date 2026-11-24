/** Fixed `DynamicsCompressorNode` parameters. */
export interface CompressorSpec {
  thresholdDb: number;
  kneeDb: number;
  ratio: number;
  attack: number;
  release: number;
}

const LOOKAHEAD_SECONDS = 0.006;
const MAKEUP_EXPONENT = 0.6;

function toDb(linear: number): number {
  return linear <= 0 ? -1000 : 20 * Math.log10(linear);
}

function fromDb(db: number): number {
  return 10 ** (db / 20);
}

/**
 * The static curve of a `DynamicsCompressorNode`: unity below the threshold,
 * an exponential knee, then the ratio slope in dB.
 */
export class CompressorCurve {
  private readonly linearThreshold: number;
  private readonly kneeThreshold: number;
  private readonly kneeThresholdDb: number;
  private readonly kneeOutputDb: number;
  private readonly slope: number;
  private readonly k: number;

  constructor(spec: Pick<CompressorSpec, "thresholdDb" | "kneeDb" | "ratio">) {
    this.linearThreshold = fromDb(spec.thresholdDb);
    this.kneeThresholdDb = spec.thresholdDb + spec.kneeDb;
    this.kneeThreshold = fromDb(this.kneeThresholdDb);
    this.slope = 1 / Math.max(1, spec.ratio);
    this.k = this.solveK();
    this.kneeOutputDb = toDb(this.knee(this.kneeThreshold, this.k));
  }

  /** Output level for a positive linear input level. */
  apply(x: number): number {
    if (x < this.linearThreshold) return x;
    if (x < this.kneeThreshold) return this.knee(x, this.k);
    return fromDb(this.kneeOutputDb + this.slope * (toDb(x) - this.kneeThresholdDb));
  }

  private knee(x: number, k: number): number {
    if (x < this.linearThreshold) return x;
    return this.linearThreshold + (1 - Math.exp(-k * (x - this.linearThreshold))) / k;
  }

  private slopeAt(x: number, k: number): number {
    const x2 = x * 1.001;
    return (toDb(this.knee(x2, k)) - toDb(this.knee(x, k))) / (toDb(x2) - toDb(x));
  }

  /** Finds the knee sharpness whose end slope equals 1 / ratio. */
  private solveK(): number {
    if (this.kneeThreshold <= this.linearThreshold) return 1;
    let low = 0.1;
    let high = 10000;
    let k = 5;
    for (let i = 0; i < 30; i++) {
      const slope = this.slopeAt(this.kneeThreshold, k);
      if (slope < this.slope) high = k;
      else low = k;
      k = Math.sqrt(low * high);
    }
    return k;
  }
}

/** Linked-stereo compressor with lookahead approximating `DynamicsCompressorNode`. */
export class StereoCompressor {
  private readonly curve: CompressorCurve;
  private readonly makeup: number;
  private readonly attackCoef: number;
  private readonly releaseCoef: number;
  private readonly lookahead: number;
  private readonly delayLeft: Float32Array;
  private readonly delayRight: Float32Array;
  private writeIndex = 0;
  private gain = 1;

  constructor(spec: CompressorSpec, sampleRate: number) {
    this.curve = new CompressorCurve(spec);
    this.makeup = (1 / this.curve.apply(1)) ** MAKEUP_EXPONENT;
    this.attackCoef = Math.exp(-1 / (Math.max(0.0001, spec.attack) * sampleRate));
    this.releaseCoef = Math.exp(-1 / (Math.max(0.0001, spec.release) * sampleRate));
    this.lookahead = Math.max(1, Math.round(LOOKAHEAD_SECONDS * sampleRate));
    this.delayLeft = new Float32Array(this.lookahead);
    this.delayRight = new Float32Array(this.lookahead);
  }

  /** Output latency in frames. */
  get latencyFrames(): number {
    return this.lookahead;
  }

  process(left: Float32Array, right: Float32Array, count = left.length): void {
    for (let i = 0; i < count; i++) {
      const l = left[i]!;
      const r = right[i]!;
      const level = Math.max(Math.abs(l), Math.abs(r));
      const target = level > 0 ? this.curve.apply(level) / level : 1;
      const coef = target < this.gain ? this.attackCoef : this.releaseCoef;
      this.gain = target + coef * (this.gain - target);
      const index = this.writeIndex;
      const delayedL = this.delayLeft[index]!;
      const delayedR = this.delayRight[index]!;
      this.delayLeft[index] = l;
      this.delayRight[index] = r;
      this.writeIndex = (index + 1) % this.lookahead;
      const g = this.gain * this.makeup;
      left[i] = delayedL * g;
      right[i] = delayedR * g;
    }
  }
}
