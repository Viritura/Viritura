import { describe, expect, it } from "vitest";
import { createDynamicGroup, type DynamicValue, type Markings, type NoteEvent, type Score } from "@viritura/core";
import { generatePerformanceEvents, type PerformanceEvent } from "../performanceEvents";

type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

type NoteOnEvent = Extract<PerformanceEvent, { kind: "noteOn" }>;
type NoteOffEvent = Extract<PerformanceEvent, { kind: "noteOff" }>;
type DynamicsEvent = Extract<PerformanceEvent, { kind: "dynamics" }>;
type TechniqueEvent = Extract<PerformanceEvent, { kind: "technique" }>;

interface NoteSpec {
  step?: Step;
  octave?: number;
  id?: string;
  eventId?: string;
  base?: "quarter" | "half" | "whole" | "eighth";
  markings?: Markings;
  tieTo?: string;
}

interface MeasureSpec {
  notes: NoteSpec[];
  expressions?: { text: string; beat: number }[];
  dynamics?: { value: DynamicValue; beat: number }[];
}

function note(spec: NoteSpec): NoteEvent {
  return {
    type: "event",
    id: spec.eventId,
    duration: { base: spec.base ?? "quarter" },
    notes: [
      {
        id: spec.id,
        pitch: { step: spec.step ?? "C", octave: spec.octave ?? 4 },
        ...(spec.tieTo ? { ties: [{ target: spec.tieTo }] } : {}),
      },
    ],
    ...(spec.markings ? { markings: spec.markings } : {}),
  };
}

function expr(text: string, beat: number) {
  return { text, position: { fraction: [beat, 4] as [number, number] } };
}

function dyn(value: DynamicValue, beat: number) {
  return createDynamicGroup(value, { fraction: [beat, 4] }, `dyn-${value}-${beat}`);
}

function buildScore(measures: MeasureSpec[]): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: measures.map(() => ({
        time: { count: 4, unit: 4 },
        tempos: [{ bpm: 120, value: { base: "quarter" } } as never],
      })),
    },
    parts: [
      {
        id: "vln",
        name: "Violin",
        measures: measures.map((measure) => ({
          sequences: [{ content: measure.notes.map(note) }],
          ...(measure.expressions ? { expressions: measure.expressions.map((e) => expr(e.text, e.beat)) } : {}),
          ...(measure.dynamics ? { dynamics: measure.dynamics.map((d) => dyn(d.value, d.beat)) } : {}),
        })),
      } as never,
    ],
  };
}

function noteOns(events: readonly PerformanceEvent[]): NoteOnEvent[] {
  return events.filter((event): event is NoteOnEvent => event.kind === "noteOn");
}

function noteOffs(events: readonly PerformanceEvent[]): NoteOffEvent[] {
  return events.filter((event): event is NoteOffEvent => event.kind === "noteOff");
}

function dynamics(events: readonly PerformanceEvent[]): DynamicsEvent[] {
  return events.filter((event): event is DynamicsEvent => event.kind === "dynamics");
}

function techniques(events: readonly PerformanceEvent[]): TechniqueEvent[] {
  return events.filter((event): event is TechniqueEvent => event.kind === "technique");
}

describe("generatePerformanceEvents", () => {
  it("emits sorted reset, noteOn, and noteOff events for a simple two-note score", () => {
    const events = generatePerformanceEvents(
      buildScore([
        {
          notes: [
            { step: "C", octave: 4, id: "n1" },
            { step: "D", octave: 4, id: "n2" },
          ],
        },
      ]),
      0,
    );

    expect(events[0]).toEqual({ kind: "reset", time: 0 });
    expect(noteOns(events)).toHaveLength(2);
    expect(noteOffs(events)).toHaveLength(2);
    expect(noteOns(events)[0]!.note).toMatchObject({ id: "n1", pitch: 60, startTime: 0, duration: 0.5 });
    expect(noteOns(events)[1]!.note).toMatchObject({ id: "n2", pitch: 62, startTime: 0.5, duration: 0.5 });
    expect(events.map((event) => event.time)).toEqual([...events.map((event) => event.time)].sort((a, b) => a - b));
  });

  it("maps staccato articulations onto performance notes", () => {
    const events = generatePerformanceEvents(buildScore([{ notes: [{ id: "stacc", markings: { staccato: {} } }] }]), 0);

    expect(noteOns(events)[0]!.note.articulations.staccato).toBe(true);
  });

  it("emits pizz/arco technique changes and stamps subsequent notes with pizzicato state", () => {
    const events = generatePerformanceEvents(
      buildScore([
        {
          expressions: [
            { text: "pizz.", beat: 0 },
            { text: "arco", beat: 2 },
          ],
          notes: [{ id: "pizz-note" }, { id: "still-pizz" }, { id: "arco-note" }],
        },
      ]),
      0,
    );

    expect(techniques(events).map((event) => ({ time: event.time, pizzicato: event.state.pizzicato }))).toEqual([
      { time: 0, pizzicato: true },
      { time: 1, pizzicato: false },
    ]);
    expect(noteOns(events)[0]!.note.state.pizzicato).toBe(true);
    expect(noteOns(events)[1]!.note.state.pizzicato).toBe(true);
    expect(noteOns(events)[2]!.note.state.pizzicato).toBe(false);
  });

  it("emits con sordino technique state", () => {
    const events = generatePerformanceEvents(
      buildScore([{ expressions: [{ text: "con sord.", beat: 0 }], notes: [{ id: "muted" }] }]),
      0,
    );

    expect(techniques(events)[0]!.state.conSordino).toBe(true);
    expect(noteOns(events)[0]!.note.state.conSordino).toBe(true);
  });

  it("merges tied notes into a single sounding performance note", () => {
    const events = generatePerformanceEvents(
      buildScore([
        {
          notes: [{ id: "tie-start", tieTo: "tie-end" }, { id: "tie-end" }],
        },
      ]),
      0,
    );

    expect(noteOns(events)).toHaveLength(1);
    expect(noteOffs(events)).toHaveLength(1);
    expect(noteOns(events)[0]!.note.id).toBe("tie-start");
    expect(noteOns(events)[0]!.note.duration).toBeCloseTo(1);
  });

  it("emits normalized 0..1 dynamics events from the CC11 envelope", () => {
    const events = generatePerformanceEvents(
      buildScore([{ dynamics: [{ value: "f", beat: 0 }], notes: [{ id: "loud" }] }]),
      0,
    );
    const dynamicEvents = dynamics(events);

    expect(dynamicEvents.length).toBeGreaterThan(0);
    expect(dynamicEvents.some((event) => event.value > 0 && event.value <= 1)).toBe(true);
  });

  it("sets noteOff time to note.startTime + note.duration", () => {
    const events = generatePerformanceEvents(buildScore([{ notes: [{ id: "n1" }] }]), 0);
    const off = noteOffs(events)[0]!;

    expect(off.time).toBeCloseTo(off.note.startTime + off.note.duration);
  });
});
