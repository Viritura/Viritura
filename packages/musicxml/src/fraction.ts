function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Simple immutable rational number for beat‑position tracking. */
export class Fraction {
  readonly n: number;
  readonly d: number;

  constructor(numerator: number, denominator: number) {
    if (denominator === 0) throw new Error("Fraction: division by zero");
    if (denominator < 0) {
      numerator = -numerator;
      denominator = -denominator;
    }
    const g = gcd(Math.abs(numerator), denominator);
    this.n = numerator / g;
    this.d = denominator / g;
  }

  static readonly ZERO = new Fraction(0, 1);

  add(other: Fraction): Fraction {
    return new Fraction(this.n * other.d + other.n * this.d, this.d * other.d);
  }

  subtract(other: Fraction): Fraction {
    return new Fraction(this.n * other.d - other.n * this.d, this.d * other.d);
  }

  isNegative(): boolean {
    return this.n < 0;
  }

  /** String key for Map lookups, e.g. "1/4". */
  key(): string {
    return `${this.n}/${this.d}`;
  }

  /** Convert to MNX position array [numerator, denominator]. */
  toMnxFraction(): [number, number] {
    if (this.d === 1) return [this.n, 1];
    return [this.n, this.d];
  }
}
