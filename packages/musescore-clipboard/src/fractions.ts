import { MuseScoreConversionError } from "./errors";

export interface Fraction {
  numerator: number;
  denominator: number;
}

const MAX_COMPONENT = 0x7fffffff;

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

export function fraction(numerator: number, denominator = 1, path?: string): Fraction {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new MuseScoreConversionError("invalid-timing", "invalid fraction", path);
  }
  if (Math.abs(numerator) > MAX_COMPONENT || Math.abs(denominator) > MAX_COMPONENT) {
    throw new MuseScoreConversionError("invalid-timing", "fraction exceeds supported range", path);
  }
  const sign = denominator < 0 ? -1 : 1;
  const divisor = gcd(numerator, denominator);
  return { numerator: (numerator * sign) / divisor, denominator: Math.abs(denominator) / divisor };
}

export function parseFraction(text: string, path: string): Fraction {
  const match = text.trim().match(/^(-?\d+)(?:\/(-?\d+))?$/);
  if (!match) throw new MuseScoreConversionError("invalid-timing", `invalid fraction "${text}"`, path);
  return fraction(Number(match[1]), match[2] === undefined ? 1 : Number(match[2]), path);
}

export function add(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function subtract(left: Fraction, right: Fraction): Fraction {
  return add(left, fraction(-right.numerator, right.denominator));
}

export function multiply(left: Fraction, right: Fraction): Fraction {
  return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function compare(left: Fraction, right: Fraction): number {
  return left.numerator * right.denominator - right.numerator * left.denominator;
}

export function isZero(value: Fraction): boolean {
  return value.numerator === 0;
}

export function formatFraction(value: Fraction): string {
  return `${value.numerator}/${value.denominator}`;
}

export function tuple(value: Fraction): [number, number] {
  return [value.numerator, value.denominator];
}

export function fromTuple(value: readonly [number, number]): Fraction {
  return fraction(value[0], value[1]);
}

export const ZERO = fraction(0);
