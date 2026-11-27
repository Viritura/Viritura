/**
 * Independently calculated click timing for qualification. Every time is a closed
 * form (constant tempo or the integral of a linear-in-beats ramp), never produced
 * by the Viritura timeline compiler under test.
 */

export type FixtureLevel = "accent" | "beat" | "subdivision";

export interface FixtureClick {
  readonly time: number;
  readonly level: FixtureLevel;
}

interface Bars {
  readonly bars: number;
  readonly beatsPerBar: number;
  readonly subdivisions: number;
  /** Seconds from bar start to beat `b` (fractional beats allowed). */
  readonly beatTime: (beat: number) => number;
}

function emit(clicks: FixtureClick[], start: number, section: Bars): number {
  const { bars, beatsPerBar, subdivisions, beatTime } = section;
  for (let bar = 0; bar < bars; bar++) {
    for (let beat = 0; beat < beatsPerBar; beat++) {
      for (let sub = 0; sub < subdivisions; sub++) {
        const position = bar * beatsPerBar + beat + sub / subdivisions;
        const level: FixtureLevel = sub > 0 ? "subdivision" : beat === 0 ? "accent" : "beat";
        clicks.push({ time: start + beatTime(position), level });
      }
    }
  }
  return start + beatTime(bars * beatsPerBar);
}

const steady = (bpm: number) => (beat: number) => (beat * 60) / bpm;

/** Linear tempo change from `from` to `to` BPM over `beats`, integrated in closed form. */
const ramp = (from: number, to: number, beats: number) => (beat: number) =>
  ((60 * beats) / (to - from)) * Math.log(1 + ((to - from) * beat) / (from * beats));

/**
 * Countoff, a meter change with subdivisions, a tempo change, a ramp, a repeated
 * section, and a compound-meter ending: about 21 seconds of clicks.
 */
export function qualificationClicks(): FixtureClick[] {
  const clicks: FixtureClick[] = [];
  let time = emit(clicks, 0, { bars: 1, beatsPerBar: 4, subdivisions: 1, beatTime: steady(100) });
  const sectionA: Bars = { bars: 2, beatsPerBar: 3, subdivisions: 2, beatTime: steady(100) };
  time = emit(clicks, time, sectionA);
  time = emit(clicks, time, { bars: 2, beatsPerBar: 4, subdivisions: 3, beatTime: steady(137) });
  time = emit(clicks, time, { bars: 2, beatsPerBar: 4, subdivisions: 2, beatTime: ramp(137, 72, 8) });
  time = emit(clicks, time, sectionA);
  // 6/8 at dotted quarter = 60: two beats per bar, three eighths per beat.
  emit(clicks, time, { bars: 1, beatsPerBar: 2, subdivisions: 3, beatTime: steady(60) });
  return clicks;
}

/**
 * The validated long program: 60 minutes of irregularly spaced clicks at the
 * 32-per-second ceiling (fourteen subdivisions at quarter = 137.15).
 */
export function longQualificationClicks(count: number): FixtureClick[] {
  const beat = 60 / 137.15;
  return Array.from({ length: count }, (_, index) => {
    const sub = index % 14;
    const level: FixtureLevel = sub > 0 ? "subdivision" : index % 56 === 0 ? "accent" : "beat";
    return { time: (Math.floor(index / 14) + sub / 14) * beat, level };
  });
}
