/** The `BiquadFilterNode` types used by the playback mix chain. */
export interface BiquadSpec {
  type: "highpass" | "lowshelf" | "highshelf" | "peaking";
  frequency: number;
  /** Shelf or peak gain in dB. */
  gain?: number;
  /** Web Audio semantics: dB for highpass, linear for peaking, ignored by shelves. */
  Q?: number;
}

interface Coefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Coefficients from the Web Audio `BiquadFilterNode` formulas (Audio EQ Cookbook variants). */
export function biquadCoefficients(spec: BiquadSpec, sampleRate: number): Coefficients {
  const w0 = (2 * Math.PI * Math.min(spec.frequency, sampleRate / 2)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = 10 ** ((spec.gain ?? 0) / 40);
  const Q = spec.Q ?? 1;
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (spec.type) {
    case "highpass": {
      const alpha = sin / (2 * 10 ** (Q / 20));
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case "lowshelf":
    case "highshelf": {
      // Shelf slope S = 1, so alpha = sin(w0) / 2 * sqrt(2).
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * (sin / 2) * Math.SQRT2;
      const sign = spec.type === "lowshelf" ? 1 : -1;
      b0 = A * (A + 1 - sign * (A - 1) * cos + twoSqrtAAlpha);
      b1 = sign * 2 * A * (A - 1 - sign * (A + 1) * cos);
      b2 = A * (A + 1 - sign * (A - 1) * cos - twoSqrtAAlpha);
      a0 = A + 1 + sign * (A - 1) * cos + twoSqrtAAlpha;
      a1 = -sign * 2 * (A - 1 + sign * (A + 1) * cos);
      a2 = A + 1 + sign * (A - 1) * cos - twoSqrtAAlpha;
      break;
    }
    case "peaking": {
      const alpha = sin / (2 * Q);
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** A stereo biquad matching one `BiquadFilterNode` with fixed parameters. */
export class StereoBiquad {
  private readonly c: Coefficients;
  // Direct form I history per channel: x1, x2, y1, y2.
  private readonly state = new Float64Array(8);

  constructor(spec: BiquadSpec, sampleRate: number) {
    this.c = biquadCoefficients(spec, sampleRate);
  }

  process(left: Float32Array, right: Float32Array, count = left.length): void {
    this.channel(left, count, 0);
    this.channel(right, count, 4);
  }

  private channel(data: Float32Array, count: number, base: number): void {
    const { b0, b1, b2, a1, a2 } = this.c;
    const s = this.state;
    let x1 = s[base]!;
    let x2 = s[base + 1]!;
    let y1 = s[base + 2]!;
    let y2 = s[base + 3]!;
    for (let i = 0; i < count; i++) {
      const x = data[i]!;
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      data[i] = y;
    }
    s[base] = x1;
    s[base + 1] = x2;
    s[base + 2] = y1;
    s[base + 3] = y2;
  }
}
