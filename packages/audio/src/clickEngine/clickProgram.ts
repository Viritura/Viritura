/** Audible weight of a recording click. */
export type ClickLevel = "accent" | "beat" | "subdivision";

/** One click in program time (seconds from the program's first frame). */
export interface ClickProgramEvent {
  readonly time: number;
  readonly level: ClickLevel;
}

/** A click program resolved to absolute sample frames for the click worklet. */
export interface CompiledClickProgram {
  readonly sampleRate: number;
  /** Program frame of every click, ascending. */
  readonly frames: Float64Array;
  /** Parallel {@link CLICK_LEVEL_CODES} entry for every click. */
  readonly levels: Uint8Array;
}

export const CLICK_LEVEL_CODES: Readonly<Record<ClickLevel, number>> = { accent: 0, beat: 1, subdivision: 2 };

/** Largest qualified program: 60 minutes at 32 click onsets per second. */
export const MAX_CLICK_PROGRAM_EVENTS = 60 * 60 * 32;

/**
 * Resolve click times to sample frames. Every frame is rounded from its absolute
 * time rather than accumulated from intervals, so rounding error never drifts
 * across a long take. Invalid programs throw instead of silently dropping clicks.
 */
export function compileClickProgram(events: readonly ClickProgramEvent[], sampleRate: number): CompiledClickProgram {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError("Click sample rate must be positive");
  if (events.length > MAX_CLICK_PROGRAM_EVENTS) {
    throw new RangeError(
      `This click track has ${events.length.toLocaleString("en-US")} clicks; ` +
        `the qualified limit is ${MAX_CLICK_PROGRAM_EVENTS.toLocaleString("en-US")} (60 minutes at 32 clicks per second)`,
    );
  }
  const frames = new Float64Array(events.length);
  const levels = new Uint8Array(events.length);
  let previous = -Infinity;
  events.forEach((event, index) => {
    if (!Number.isFinite(event.time) || event.time < 0) {
      throw new RangeError(`Click ${index} has an invalid time (${event.time})`);
    }
    if (event.time < previous) throw new RangeError(`Click ${index} is earlier than the click before it`);
    const code = CLICK_LEVEL_CODES[event.level];
    if (code === undefined) throw new RangeError(`Click ${index} has an unknown level`);
    previous = event.time;
    frames[index] = Math.round(event.time * sampleRate);
    levels[index] = code;
  });
  return { sampleRate, frames, levels };
}
