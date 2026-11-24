/** A stereo fixed delay with linear interpolation for fractional frame counts. */
export class StereoDelay {
  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readonly whole: number;
  private readonly fraction: number;
  private writeIndex = 0;

  constructor(seconds: number, sampleRate: number) {
    const frames = Math.max(0, seconds * sampleRate);
    this.whole = Math.floor(frames);
    this.fraction = frames - this.whole;
    const size = this.whole + 2;
    this.left = new Float32Array(size);
    this.right = new Float32Array(size);
  }

  process(left: Float32Array, right: Float32Array, count = left.length): void {
    if (this.whole === 0 && this.fraction === 0) return;
    const size = this.left.length;
    for (let i = 0; i < count; i++) {
      const w = this.writeIndex;
      this.left[w] = left[i]!;
      this.right[w] = right[i]!;
      const a = (w - this.whole + size) % size;
      const b = (a - 1 + size) % size;
      left[i] = this.left[a]! + (this.left[b]! - this.left[a]!) * this.fraction;
      right[i] = this.right[a]! + (this.right[b]! - this.right[a]!) * this.fraction;
      this.writeIndex = (w + 1) % size;
    }
  }
}
