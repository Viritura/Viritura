/** In-place iterative radix-2 complex FFT. */
export class Fft {
  readonly size: number;
  private readonly reversed: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error("FFT size must be a power of two.");
    this.size = size;
    const bits = Math.log2(size);
    this.reversed = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reversed[i] = r;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let k = 0; k < size / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / size);
      this.sin[k] = Math.sin((2 * Math.PI * k) / size);
    }
  }

  /** Forward transform uses e^(-i), and inverse includes the 1/N scale. */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = this.size;
    const rev = this.reversed;
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }
    const direction = inverse ? 1 : -1;
    for (let length = 2; length <= n; length <<= 1) {
      const half = length >> 1;
      const step = n / length;
      for (let start = 0; start < n; start += length) {
        for (let j = 0; j < half; j++) {
          const wr = this.cos[j * step]!;
          const wi = direction * this.sin[j * step]!;
          const a = start + j;
          const b = a + half;
          const tr = re[b]! * wr - im[b]! * wi;
          const ti = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - tr;
          im[b] = im[a]! - ti;
          re[a] = re[a]! + tr;
          im[a] = im[a]! + ti;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] = re[i]! / n;
        im[i] = im[i]! / n;
      }
    }
  }
}
