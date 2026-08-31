import { describe, it, expect } from "vitest";
import { Fraction } from "../fraction";

describe("Fraction", () => {
  it("simplifies on construction", () => {
    const f = new Fraction(2, 4);
    expect(f.n).toBe(1);
    expect(f.d).toBe(2);
  });

  it("adds fractions", () => {
    const sum = new Fraction(1, 4).add(new Fraction(1, 4));
    expect(sum.n).toBe(1);
    expect(sum.d).toBe(2);
  });

  it("subtracts fractions", () => {
    const diff = new Fraction(3, 4).subtract(new Fraction(1, 4));
    expect(diff.n).toBe(1);
    expect(diff.d).toBe(2);
  });

  it("detects negative", () => {
    const f = new Fraction(1, 4).subtract(new Fraction(1, 2));
    expect(f.isNegative()).toBe(true);
  });

  it("generates string key", () => {
    expect(new Fraction(1, 4).key()).toBe("1/4");
    expect(new Fraction(3, 8).key()).toBe("3/8");
  });

  it("converts to MNX fraction", () => {
    expect(new Fraction(3, 4).toMnxFraction()).toEqual([3, 4]);
    expect(new Fraction(2, 1).toMnxFraction()).toEqual([2, 1]);
  });

  it("ZERO is 0/1", () => {
    expect(Fraction.ZERO.n).toBe(0);
    expect(Fraction.ZERO.d).toBe(1);
  });

  it("throws on division by zero", () => {
    expect(() => new Fraction(1, 0)).toThrow();
  });
});
