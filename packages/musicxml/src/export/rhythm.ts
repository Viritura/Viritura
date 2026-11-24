import {
  DURATION_BEATS,
  type Duration,
  type Grace,
  type NoteEvent,
  type Sequence,
  type SequenceContent,
  type Tuplet,
} from "@viritura/core";

export interface Rational {
  n: bigint;
  d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function rational(n: number | bigint, d: number | bigint = 1): Rational {
  if ((typeof n === "number" && !Number.isSafeInteger(n)) || (typeof d === "number" && !Number.isSafeInteger(d))) {
    throw new Error("MusicXML rhythm requires exact integer fractions.");
  }
  let numerator = BigInt(n);
  let denominator = BigInt(d);
  if (denominator === 0n) throw new Error("MusicXML rhythm has a zero denominator.");
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcd(numerator, denominator);
  return { n: numerator / divisor, d: denominator / divisor };
}

export const ZERO = rational(0);
export const ONE = rational(1);
export function add(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}
export function subtract(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}
export function multiply(a: Rational, b: Rational): Rational {
  return rational(a.n * b.n, a.d * b.d);
}
export function divide(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d, a.d * b.n);
}
export function compare(a: Rational, b: Rational): number {
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

export function rebasePosition(
  mi: number,
  value: Rational,
  durations: readonly Rational[],
): { mi: number; position: Rational } {
  let position = value;
  while (compare(position, ZERO) < 0 && mi > 0) position = add(position, durations[--mi]!);
  while (compare(position, durations[mi]!) > 0 && mi < durations.length - 1)
    position = subtract(position, durations[mi++]!);
  return { mi, position };
}

export function durationOf(duration: Duration): Rational {
  const beats = DURATION_BEATS[duration.base];
  const dots = duration.dots ?? 0;
  if (!beats || !Number.isSafeInteger(dots) || dots < 0 || dots > 30)
    throw new Error("Invalid note duration in MusicXML export.");
  const base = rational(beats * 1024, 4096);
  const divisor = 2n ** BigInt(dots);
  return multiply(base, rational(divisor * 2n - 1n, divisor));
}

export function noteType(duration: Duration): string | undefined {
  if (duration.base === "longa") return "long";
  if (duration.base === "duplexMaxima" || duration.base === "2048th" || duration.base === "4096th") return undefined;
  return duration.base;
}

export interface TupletBoundary {
  tuplet: Tuplet;
  number: number;
  type: "start" | "stop";
}

export interface TimedEvent {
  event: NoteEvent;
  position: Rational;
  duration: Rational;
  scale: Rational;
  grace?: Grace;
  tuplets: TupletBoundary[];
  tremolo?: { type: "start" | "stop"; marks: number };
  fullMeasure?: boolean;
}

interface TimedSpace {
  position: Rational;
  duration: Rational;
}

export interface TimedSequence {
  sequence: Sequence;
  events: TimedEvent[];
  spaces: TimedSpace[];
  duration: Rational;
}

export function timeSequence(sequence: Sequence, scale: Rational = ONE): TimedSequence {
  const events: TimedEvent[] = [];
  const spaces: TimedSpace[] = [];
  const walk = (content: readonly SequenceContent[], position: Rational, ratio: Rational, depth: number): Rational => {
    let cursor = position;
    for (const item of content) {
      switch (item.type) {
        case "event": {
          const duration = multiply(durationOf(item.duration), ratio);
          events.push({ event: item, position: cursor, duration, scale: ratio, tuplets: [] });
          cursor = add(cursor, duration);
          break;
        }
        case "space": {
          const duration = multiply(rational(...item.duration), ratio);
          if (duration.n < 0n) throw new Error("A rhythmic space cannot have negative duration.");
          spaces.push({ position: cursor, duration });
          cursor = add(cursor, duration);
          break;
        }
        case "grace":
          for (const event of item.content)
            events.push({ event, position: cursor, duration: ZERO, scale: ratio, grace: item, tuplets: [] });
          break;
        case "tuplet": {
          if (depth > 16) throw new Error("MusicXML supports at most 16 nested tuplet levels.");
          const inner = multiply(durationOf(item.inner.duration), rational(item.inner.multiple));
          const outer = multiply(durationOf(item.outer.duration), rational(item.outer.multiple));
          if (inner.n <= 0n || outer.n <= 0n) throw new Error("A tuplet must have positive inner and outer durations.");
          const start = events.length;
          cursor = walk(item.content, cursor, multiply(ratio, divide(outer, inner)), depth + 1);
          const rhythmic = events.slice(start).filter((event) => !event.grace);
          if (!item.span || item.span.type === "start")
            rhythmic[0]?.tuplets.unshift({ tuplet: item, number: depth, type: "start" });
          if (!item.span || item.span.type === "stop")
            rhythmic.at(-1)?.tuplets.push({ tuplet: item, number: depth, type: "stop" });
          break;
        }
        case "tremolo": {
          if (item.content.length !== 2) throw new Error("A two-note tremolo must contain two events.");
          const duration = multiply(multiply(durationOf(item.outer.duration), rational(item.outer.multiple, 2)), ratio);
          item.content.forEach((event, i) => {
            const written = item.individualDuration ? { ...event, duration: item.individualDuration } : event;
            events.push({
              event: written,
              position: cursor,
              duration,
              scale: ratio,
              tuplets: [],
              tremolo: { type: i === 0 ? "start" : "stop", marks: item.marks },
            });
            cursor = add(cursor, duration);
          });
          break;
        }
      }
    }
    return cursor;
  };
  return { sequence, events, spaces, duration: walk(sequence.content, ZERO, scale, 1) };
}

/** All timing values are whole-note fractions; MusicXML divisions count quarter notes. */
export function divisionsFor(values: readonly Rational[]): bigint {
  let divisions = 1n;
  for (const value of values) {
    const quarters = multiply(value, rational(4));
    divisions = (divisions / gcd(divisions, quarters.d)) * quarters.d;
  }
  if (divisions > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("MusicXML divisions exceed interoperable numeric precision.");
  return divisions;
}

export function ticks(value: Rational, divisions: bigint): string {
  const scaled = multiply(value, rational(divisions * 4n));
  if (scaled.d !== 1n || scaled.n > BigInt(Number.MAX_SAFE_INTEGER) || scaled.n < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("MusicXML timing exceeds interoperable numeric precision.");
  }
  return String(scaled.n);
}
