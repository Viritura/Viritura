import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { generateTimeline } from "../timeline";
import { writeMidiFile } from "../midiFile";

interface ParsedEvent {
  tick: number;
  status: number;
  data: number[];
}

function parse(bytes: Uint8Array): { division: number; tracks: ParsedEvent[][] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("MThd");
  expect(view.getUint16(8)).toBe(1);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  let pos = 14;
  const tracks: ParsedEvent[][] = [];
  const vlq = () => {
    let value = 0;
    let byte: number;
    do {
      byte = bytes[pos++]!;
      value = value * 128 + (byte & 127);
    } while (byte & 128);
    return value;
  };
  for (let i = 0; i < trackCount; i++) {
    expect(new TextDecoder().decode(bytes.slice(pos, pos + 4))).toBe("MTrk");
    const end = pos + 8 + view.getUint32(pos + 4);
    pos += 8;
    let tick = 0;
    const events: ParsedEvent[] = [];
    while (pos < end) {
      tick += vlq();
      const status = bytes[pos++]!;
      if (status === 0xff) {
        const type = bytes[pos++]!;
        const size = vlq();
        events.push({ tick, status: 0xff00 | type, data: [...bytes.slice(pos, pos + size)] });
        pos += size;
      } else {
        const size = (status & 0xf0) === 0xc0 ? 1 : 2;
        events.push({ tick, status, data: [...bytes.slice(pos, pos + size)] });
        pos += size;
      }
    }
    expect(pos).toBe(end);
    expect(events.at(-1)?.status).toBe(0xff2f);
    tracks.push(events);
  }
  expect(pos).toBe(bytes.length);
  return { division, tracks };
}

function secondsAt(tick: number, tempos: ParsedEvent[], division: number): number {
  let seconds = 0;
  let previousTick = 0;
  let tempo = 500_000;
  for (const event of tempos) {
    if (event.tick > tick) break;
    seconds += ((event.tick - previousTick) * tempo) / division / 1_000_000;
    tempo = event.data[0]! * 65536 + event.data[1]! * 256 + event.data[2]!;
    previousTick = event.tick;
  }
  return seconds + ((tick - previousTick) * tempo) / division / 1_000_000;
}

function score(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } }],
          chordSymbols: [{ root: { step: "C" }, position: { fraction: [0, 1] } }],
        },
      ],
    },
    parts: [
      {
        name: "Violin",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
                    markings: { staccato: {}, accent: {} },
                  },
                  {
                    type: "event",
                    id: "slur",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "E", octave: 4 } }],
                    slurs: [{ target: "end" }],
                  },
                  {
                    type: "event",
                    id: "end",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "F", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("Standard MIDI File export", () => {
  it("writes instruments, meter and tempo with exact attacks, articulations and legato", () => {
    const timeline = generateTimeline(score(), {
      partPrograms: [40],
      includeGlobalChords: false,
      humanizeTiming: false,
    });
    const { division, tracks } = parse(writeMidiFile(timeline, ["Violin"], [40]));
    const conductor = tracks[0]!;
    const part = tracks[1]!;
    expect(tracks).toHaveLength(2);
    expect(conductor.find((event) => event.status === 0xff51)?.data).toEqual([7, 161, 32]);
    expect(conductor.find((event) => event.status === 0xff58)?.data).toEqual([4, 2, 24, 8]);
    expect(part.find((event) => event.status === 0xc0)?.data).toEqual([40]);
    const ons = part.filter((event) => (event.status & 0xf0) === 0x90);
    const offs = part.filter((event) => (event.status & 0xf0) === 0x80);
    expect(ons.map((event) => event.tick)).toEqual([0, division, division * 2, division * 3]);
    expect(ons.map((event) => event.data[0])).toEqual([60, 62, 64, 65]);
    expect(offs.find((event) => event.data[0] === 62)!.tick).toBe(division * 1.5);
    expect(ons[1]!.data[1]).toBeGreaterThan(ons[0]!.data[1]!);
    expect(offs.find((event) => event.data[0] === 64)!.tick).toBeGreaterThan(division * 3);
    expect(part.some((event) => (event.status & 0xf0) === 0xb0 && event.data[0] === 11)).toBe(true);
    expect(part.at(-1)?.tick).toBe(division * 4);
    expect(conductor.at(-1)?.tick).toBe(division * 4);
  });

  it("preserves tempo ramps and inserted holds in the actual file's playback time", () => {
    const input = score();
    input.global.measures[0]!.id = "m0";
    input.global.measures[0]!.gradualTempo = {
      position: { fraction: [0, 1] },
      end: { measure: "m1", position: { fraction: [0, 1] } },
      endRatio: 0.5,
    };
    input.global.measures.push({ id: "m1" });
    const first = input.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (first.type !== "event") throw new Error("Expected note");
    first.fermata = {};
    input.global.measures[0]!.fermatas = [{ id: "hold", position: { fraction: [0, 1] } }];
    input.parts[0]!.measures.push({
      sequences: [
        {
          content: [
            {
              type: "event",
              duration: { base: "whole" },
              notes: [{ pitch: { step: "G", octave: 4 } }],
            },
          ],
        },
      ],
    });
    const timeline = generateTimeline(input, { partPrograms: [40], includeGlobalChords: false, humanizeTiming: false });
    const { division, tracks } = parse(writeMidiFile(timeline, ["Violin"], [40]));
    const tempos = tracks[0]!.filter((event) => event.status === 0xff51);
    expect(tempos.length).toBeGreaterThan(2);
    const attacks = tracks[1]!.filter((event) => (event.status & 0xf0) === 0x90);
    const originalAttacks = timeline.events.filter((event) => event.type === "noteOn");
    expect(attacks).toHaveLength(originalAttacks.length);
    for (let i = 0; i < attacks.length; i++) {
      expect(secondsAt(attacks[i]!.tick, tempos, division)).toBeCloseTo(originalAttacks[i]!.time, 3);
    }
    expect(attacks[1]!.tick).toBeGreaterThan(division);
  });

  it("keeps playback humanization enabled unless explicitly disabled", () => {
    const input = score();
    const normal = generateTimeline(input, { includeGlobalChords: false });
    const exact = generateTimeline(input, { includeGlobalChords: false, humanizeTiming: false });
    const attacks = (timeline: typeof normal) => timeline.events.filter((event) => event.type === "noteOn");
    expect(attacks(normal).some((event) => event.time !== event.nominalTime)).toBe(true);
    expect(attacks(exact).every((event) => event.time === event.nominalTime)).toBe(true);
    const off = exact.events.find((event) => event.type === "noteOff" && event.midiNote === 64)!;
    const next = attacks(exact).find((event) => event.midiNote === 65)!;
    expect(off.time - next.time).toBeCloseTo(0.02, 6);
  });

  it("writes repeated measures as played and preserves repeated-pitch release order", () => {
    const input = score();
    input.global.measures[0]!.repeatEnd = {};
    const content = input.parts[0]!.measures[0]!.sequences[0]!.content;
    content.splice(
      0,
      content.length,
      {
        type: "event",
        id: "first",
        duration: { base: "half" },
        notes: [{ pitch: { step: "C", octave: 4 } }],
        slurs: [{ target: "second" }],
      },
      { type: "event", id: "second", duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
    );
    const timeline = generateTimeline(input, { partPrograms: [40], includeGlobalChords: false, humanizeTiming: false });
    const { division, tracks } = parse(writeMidiFile(timeline, ["Violin"], [40]));
    const notes = tracks[1]!.filter((event) => (event.status & 0xf0) === 0x80 || (event.status & 0xf0) === 0x90);
    expect(notes.filter((event) => (event.status & 0xf0) === 0x90).map((event) => event.tick)).toEqual([
      0,
      division * 2,
      division * 4,
      division * 6,
    ]);
    expect(notes.filter((event) => event.tick === division * 2).map((event) => event.status & 0xf0)).toEqual([
      0x80, 0x90,
    ]);
  });
});
