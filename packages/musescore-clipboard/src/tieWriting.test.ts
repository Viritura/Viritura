import { describe, expect, it } from "vitest";
import type { Duration, Note, NoteEvent, SequenceContent, Tie, Tuplet } from "@viritura/core";
import { MuseScoreConversionError } from "./errors";
import { buildTieConnectors, orderedMuseScoreNotes, type TieExportTrack } from "./tieWriting";

function note(id?: string, step: Note["pitch"]["step"] = "C", octave: Note["pitch"]["octave"] = 4): Note {
  return { ...(id === undefined ? {} : { id }), pitch: { step, octave } };
}

function chord(notes: Note[], duration: Duration = { base: "quarter" }): NoteEvent {
  return { type: "event", duration, notes };
}

function track(content: SequenceContent[], overrides: Partial<TieExportTrack> = {}): TieExportTrack {
  return { staff: 0, voice: 0, partOffset: 0, content, ...overrides };
}

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeDeep(child);
  Object.freeze(value);
}

function expectRejected(tracks: TieExportTrack[], message: RegExp): void {
  const before = JSON.stringify(tracks);
  freezeDeep(tracks);
  expect(() => buildTieConnectors(tracks)).toThrow(MuseScoreConversionError);
  expect(() => buildTieConnectors(tracks)).toThrow(message);
  expect(JSON.stringify(tracks)).toBe(before);
}

const QUARTER_START =
  '<Spanner type="Tie"><Tie><ticks_f>1/4</ticks_f></Tie>' +
  "<next><location><fractions>1/4</fractions></location></next></Spanner>";
const QUARTER_END = '<Spanner type="Tie"><prev><location><fractions>-1/4</fractions></location></prev></Spanner>';

describe("orderedMuseScoreNotes", () => {
  it("returns a stable ascending MIDI-pitch copy using original note objects", () => {
    const high = note("high", "C", 5);
    const sharp = { ...note("sharp"), pitch: { step: "C", octave: 4, alter: 1 } } satisfies Note;
    const flat = { ...note("flat"), pitch: { step: "D", octave: 4, alter: -1 } } satisfies Note;
    const samePitch = note("same-pitch", "C");
    samePitch.pitch.alter = 1;
    const low = note("low", "B", 3);
    const source = [high, sharp, low, flat, samePitch];
    const before = JSON.stringify(source);
    freezeDeep(source);

    const ordered = orderedMuseScoreNotes(source);

    expect(ordered).not.toBe(source);
    expect(ordered).toEqual([low, sharp, flat, samePitch, high]);
    expect(ordered[1]).toBe(sharp);
    expect(ordered[2]).toBe(flat);
    expect(ordered[3]).toBe(samePitch);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("returns a new empty array", () => {
    const source: Note[] = [];
    expect(orderedMuseScoreNotes(source)).toEqual([]);
    expect(orderedMuseScoreNotes(source)).not.toBe(source);
  });

  it.each([Number.NaN, 0.5, 80, -80])("rejects unsupported MIDI pitch alteration %s", (alter) => {
    const invalid = note();
    invalid.pitch.alter = alter;
    expect(() => orderedMuseScoreNotes([invalid])).toThrow(MuseScoreConversionError);
  });
});

describe("buildTieConnectors", () => {
  it("emits exact reciprocal connectors without adding IDs to an anonymous source or untied note", () => {
    const start = note();
    const end = note("end");
    const ordinary = note();
    start.ties = [{ target: "end" }];
    const tracks = [track([chord([start]), chord([end]), chord([ordinary])])];
    const before = JSON.stringify(tracks);
    freezeDeep(tracks);

    const result = buildTieConnectors(tracks);

    expect(result.size).toBe(2);
    expect(result.get(start)).toBe(QUARTER_START);
    expect(result.get(end)).toBe(QUARTER_END);
    expect(result.has(ordinary)).toBe(false);
    expect(start.id).toBeUndefined();
    expect(ordinary.id).toBeUndefined();
    expect(JSON.stringify(tracks)).toBe(before);
  });

  it("does not require IDs or connectors for untied ordinary notes", () => {
    const tracks = [track([chord([note(), note(undefined, "G")]), chord([note()])])];
    freezeDeep(tracks);
    expect(buildTieConnectors(tracks).size).toBe(0);
    expect(buildTieConnectors([]).size).toBe(0);
  });

  it.each(["nextNote", "crossVoice"] as const)("accepts explicit %s targets", (targetType) => {
    const start = note("start");
    const end = note("end");
    start.ties = [{ target: "end", targetType, lv: false }];
    const result = buildTieConnectors([track([chord([start]), chord([end])])]);
    expect(result.get(start)).toBe(QUARTER_START);
    expect(result.get(end)).toBe(QUARTER_END);
  });

  it.each(["up", "down"] as const)("preserves tie side %s in the canonical MuseScore up property", (side) => {
    const start = note("start");
    const end = note("end");
    start.ties = [{ target: "end", side }];
    const result = buildTieConnectors([track([chord([start]), chord([end])])]);
    expect(result.get(start)).toBe(
      `<Spanner type="Tie"><Tie><up>${side}</up><ticks_f>1/4</ticks_f></Tie>` +
        "<next><location><fractions>1/4</fractions></location></next></Spanner>",
    );
    expect(result.get(end)).toBe(QUARTER_END);
  });

  it("uses independent staff and voice deltas, sorted note ordinals and track lead-ins", () => {
    const start = note("start", "G");
    const end = note("end", "G");
    start.ties = [{ target: "end", targetType: "crossVoice" }];
    const tracks = [
      track([chord([note("above", "C", 5), end])], { staff: 4, voice: 1, partOffset: 1, leadIn: [5, 8] }),
      track([chord([start, note("below", "C")])], { staff: 1, voice: 3, leadIn: [1, 8] }),
    ];
    const before = JSON.stringify(tracks);
    freezeDeep(tracks);

    const result = buildTieConnectors(tracks);

    expect(result.get(start)).toBe(
      '<Spanner type="Tie"><Tie><ticks_f>1/2</ticks_f></Tie><next><location>' +
        "<staves>3</staves><voices>-2</voices><fractions>1/2</fractions><notes>-1</notes>" +
        "</location></next></Spanner>",
    );
    expect(result.get(end)).toBe(
      '<Spanner type="Tie"><prev><location>' +
        "<staves>-3</staves><voices>2</voices><fractions>-1/2</fractions><notes>1</notes>" +
        "</location></prev></Spanner>",
    );
    expect(result.size).toBe(2);
    expect(JSON.stringify(tracks)).toBe(before);
  });

  it("chains ties through reordered pitched chords, with start before end on middle notes", () => {
    const a = note("a");
    const b = note("b", "G");
    const c = note("c");
    const d = note("d", "G");
    const e = note("e");
    a.ties = [{ target: "c" }];
    b.ties = [{ target: "d" }];
    c.ties = [{ target: "e" }];
    const result = buildTieConnectors([track([chord([a, b]), chord([d, c]), chord([e])])]);

    expect(result.get(a)).toBe(QUARTER_START);
    expect(result.get(b)).toBe(QUARTER_START);
    expect(result.get(c)).toBe(QUARTER_START + QUARTER_END);
    expect(result.get(d)).toBe(QUARTER_END);
    expect(result.get(e)).toBe(QUARTER_END);
    expect(result.size).toBe(5);
  });

  it("omits note deltas for the same nonzero chord ordinal", () => {
    const start = note("start", "G");
    const end = note("end", "G");
    start.ties = [{ target: "end" }];
    const result = buildTieConnectors([
      track([chord([start, note(undefined, "C")]), chord([end, note(undefined, "E")])]),
    ]);
    expect(result.get(start)).toBe(QUARTER_START);
    expect(result.get(end)).toBe(QUARTER_END);
  });

  it("uses canonical XML source index 1 for the middle pitch in a triad", () => {
    const start = note("start");
    const end = note("end");
    start.ties = [{ target: "end" }];
    const tracks = [track([chord([note(undefined, "G"), start, note(undefined, "B", 3)]), chord([end])])];
    const before = JSON.stringify(tracks);
    freezeDeep(tracks);

    const result = buildTieConnectors(tracks);

    expect(result.size).toBe(2);
    expect(result.get(start)).toBe(
      '<Spanner type="Tie"><Tie><ticks_f>1/4</ticks_f></Tie>' +
        "<next><location><fractions>1/4</fractions><notes>-1</notes></location></next></Spanner>",
    );
    expect(result.get(end)).toBe(
      '<Spanner type="Tie"><prev><location><fractions>-1/4</fractions><notes>1</notes></location></prev></Spanner>',
    );
    expect(JSON.stringify(tracks)).toBe(before);
  });

  it("indexes distinct-pitch endpoints in the exact sorted XML sequence of unsorted triads", () => {
    const cStart = note("c-start");
    const cEnd = note("c-end");
    const eStart = note("e-start", "E");
    const eEnd = note("e-end", "E");
    const gStart = note("g-start", "G");
    const gEnd = note("g-end", "G");
    cStart.ties = [{ target: "c-end" }];
    eStart.ties = [{ target: "e-end" }];
    gStart.ties = [{ target: "g-end" }];
    const from = [eStart, cStart, gStart];
    const to = [gEnd, eEnd, cEnd];
    const tracks = [track([chord(from), chord(to)])];
    const before = JSON.stringify(tracks);
    freezeDeep(tracks);

    const result = buildTieConnectors(tracks);

    expect(orderedMuseScoreNotes(from).map((item) => item.id)).toEqual(["c-start", "e-start", "g-start"]);
    expect(orderedMuseScoreNotes(to).map((item) => item.id)).toEqual(["c-end", "e-end", "g-end"]);
    for (const start of [cStart, eStart, gStart]) expect(result.get(start)).toBe(QUARTER_START);
    for (const end of [cEnd, eEnd, gEnd]) expect(result.get(end)).toBe(QUARTER_END);
    expect(result.size).toBe(6);
    expect(JSON.stringify(tracks)).toBe(before);
  });

  it("includes intervening rests and spaces in elapsed onset time", () => {
    const start = note("start");
    const end = note("end");
    start.ties = [{ target: "end" }];
    const result = buildTieConnectors([
      track([
        chord([start], { base: "eighth" }),
        { type: "event", duration: { base: "quarter", dots: 1 }, rest: {} },
        { type: "space", duration: [1, 8] },
        chord([end]),
      ]),
    ]);
    expect(result.get(start)).toBe(
      '<Spanner type="Tie"><Tie><ticks_f>5/8</ticks_f></Tie>' +
        "<next><location><fractions>5/8</fractions></location></next></Spanner>",
    );
    expect(result.get(end)).toBe(
      '<Spanner type="Tie"><prev><location><fractions>-5/8</fractions></location></prev></Spanner>',
    );
  });

  it("uses nested outer-total/inner-total scales, spaces, dotted values and elapsed onset rather than duration", () => {
    const start = note("start");
    const end = note("end");
    const after = note("after");
    start.ties = [{ target: "end" }];
    end.ties = [{ target: "after" }];
    const nested: Tuplet = {
      type: "tuplet",
      inner: { duration: { base: "eighth" }, multiple: 3 },
      outer: { duration: { base: "16th" }, multiple: 2 },
      content: [
        chord([start], { base: "eighth", dots: 1 }),
        { type: "space", duration: [1, 16] },
        chord([end], { base: "eighth" }),
      ],
    };
    const outer: Tuplet = {
      type: "tuplet",
      inner: { duration: { base: "quarter" }, multiple: 3 },
      outer: { duration: { base: "quarter", dots: 1 }, multiple: 2 },
      content: [{ type: "space", duration: [1, 8] }, nested, chord([note("filler", "D")], { base: "half" })],
    };
    const tracks = [track([outer, chord([after])], { leadIn: [1, 8] })];
    const before = JSON.stringify(tracks);
    freezeDeep(tracks);
    const result = buildTieConnectors(tracks);

    expect(result.get(start)).toBe(
      '<Spanner type="Tie"><Tie><ticks_f>1/12</ticks_f></Tie>' +
        "<next><location><fractions>1/12</fractions></location></next></Spanner>",
    );
    expect(result.get(end)).toBe(
      '<Spanner type="Tie"><Tie><ticks_f>13/24</ticks_f></Tie>' +
        "<next><location><fractions>13/24</fractions></location></next></Spanner>" +
        '<Spanner type="Tie"><prev><location><fractions>-1/12</fractions></location></prev></Spanner>',
    );
    expect(result.get(after)).toBe(
      '<Spanner type="Tie"><prev><location><fractions>-13/24</fractions></location></prev></Spanner>',
    );
    expect(JSON.stringify(tracks)).toBe(before);
  });

  it("multiplies all nested tuplet scales instead of using only the innermost ratio", () => {
    const start = note("start");
    const end = note("end");
    start.ties = [{ target: "end" }];
    const nested: Tuplet = {
      type: "tuplet",
      inner: { duration: { base: "eighth" }, multiple: 5 },
      outer: { duration: { base: "eighth" }, multiple: 4 },
      content: Array.from({ length: 5 }, (_, index) => chord([index === 0 ? start : note()], { base: "eighth" })),
    };
    const outer: Tuplet = {
      type: "tuplet",
      inner: { duration: { base: "quarter" }, multiple: 3 },
      outer: { duration: { base: "quarter" }, multiple: 2 },
      content: [nested, chord([end])],
    };
    const result = buildTieConnectors([track([outer])]);
    expect(result.get(start)).toBe(
      '<Spanner type="Tie"><Tie><ticks_f>1/3</ticks_f></Tie>' +
        "<next><location><fractions>1/3</fractions></location></next></Spanner>",
    );
    expect(result.get(end)).toBe(
      '<Spanner type="Tie"><prev><location><fractions>-1/3</fractions></location></prev></Spanner>',
    );
  });

  it("indexes untied grace notes without advancing main-note time or making anchor locations ambiguous", () => {
    const start = note("start");
    const end = note("end");
    start.ties = [{ target: "end" }];
    const result = buildTieConnectors([
      track([
        { type: "grace", content: [chord([note("grace")], { base: "eighth" })] },
        chord([start]),
        { type: "grace", content: [chord([note("grace2")], { base: "eighth" })] },
        chord([end]),
      ]),
    ]);
    expect(result.get(start)).toBe(QUARTER_START);
    expect(result.get(end)).toBe(QUARTER_END);
  });

  it("accepts equal MIDI pitches with different enharmonic spellings", () => {
    const start = note("start", "C");
    start.pitch.alter = 1;
    const end = note("end", "D");
    end.pitch.alter = -1;
    start.ties = [{ target: "end" }];
    const result = buildTieConnectors([track([chord([start]), chord([end])])]);
    expect(result.get(start)).toBe(QUARTER_START);
    expect(result.get(end)).toBe(QUARTER_END);
  });
});

describe("tie export rejection", () => {
  it.each([
    { name: "absent target", tie: {} },
    { name: "implicit nextNote", tie: { targetType: "nextNote" } },
    { name: "empty target", tie: { target: "" } },
    { name: "whitespace target", tie: { target: " " } },
  ] satisfies { name: string; tie: Tie }[])("rejects $name rather than guessing a target", ({ tie }) => {
    const start = note("start");
    start.ties = [tie];
    expectRejected([track([chord([start]), chord([note("end")])])], /missing.*target/);
  });

  it("rejects orphan targets outside the selected tracks", () => {
    const start = note("start");
    start.ties = [{ target: "not-copied" }];
    expectRejected([track([chord([start])])], /outside the copied selection/);
  });

  it("does not mistake an event ID for a note target", () => {
    const start = note("start");
    start.ties = [{ target: "event-id" }];
    expectRejected([track([chord([start]), { ...chord([note()]), id: "event-id" }])], /not a note/);
  });

  it.each(["source", "target"] as const)("rejects duplicate %s IDs across all tracks", (duplicate) => {
    const start = note("source");
    const end = note("target");
    start.ties = [{ target: "target" }];
    expectRejected(
      [track([chord([start]), chord([end])]), track([chord([note(duplicate)])], { staff: 1, voice: 2, partOffset: 1 })],
      /duplicate note ID.*ambiguous/,
    );
  });

  it("includes grace notes in duplicate ID detection", () => {
    const start = note("start");
    start.ties = [{ target: "end" }];
    expectRejected(
      [track([chord([start]), { type: "grace", content: [chord([note("end")])] }, chord([note("end")])])],
      /duplicate note ID/,
    );
  });

  it.each(["source", "target"] as const)(
    "rejects ambiguous %s connector locations even with unique IDs",
    (endpoint) => {
      const start = note("start");
      start.ties = [{ target: "end" }];
      expectRejected(
        [
          track([chord([start]), chord([note("end")])]),
          track([chord([note("overlapping")])], { leadIn: endpoint === "source" ? [0, 1] : [1, 4] }),
        ],
        /endpoint location is ambiguous/,
      );
    },
  );

  it("rejects overlapping chords even if the tied ordinal exists in only one of them", () => {
    const start = note("start", "G");
    start.ties = [{ target: "end" }];
    expectRejected(
      [track([chord([note("low"), start]), chord([note("end", "G")])]), track([chord([note("overlapping")])])],
      /endpoint location is ambiguous/,
    );
  });

  it("rejects cross-pitch endpoints", () => {
    const start = note("start");
    start.ties = [{ target: "end" }];
    expectRejected([track([chord([start]), chord([note("end", "D")])])], /same MIDI pitch/);
  });

  it.each(["backward", "simultaneous", "self"] as const)("rejects %s connectors", (kind) => {
    const start = note("start");
    const end = note("end");
    start.ties = [{ target: kind === "self" ? "start" : "end" }];
    const content = kind === "backward" ? [chord([end]), chord([start])] : [chord([start, end])];
    expectRejected([track(content)], /strictly later/);
  });

  it("rejects time-coincident crossvoice ties", () => {
    const start = note("start");
    start.ties = [{ target: "end", targetType: "crossVoice" }];
    expectRejected([track([chord([start])]), track([chord([note("end")])], { voice: 1 })], /strictly later/);
  });

  it.each(["source", "target"] as const)("explicitly rejects grace %s ties", (endpoint) => {
    const start = note("start");
    const end = note("end");
    start.ties = [{ target: "end" }];
    const content: SequenceContent[] =
      endpoint === "source"
        ? [{ type: "grace", content: [chord([start])] }, chord([end])]
        : [chord([start]), { type: "grace", content: [chord([end])] }];
    expectRejected([track(content)], /ties involving grace notes/);
  });

  it("finds a grace target recursively inside a different track's tuplet", () => {
    const start = note("start");
    start.ties = [{ target: "grace", targetType: "crossVoice" }];
    expectRejected(
      [
        track([chord([start])]),
        track(
          [
            {
              type: "tuplet",
              inner: { duration: { base: "eighth" }, multiple: 3 },
              outer: { duration: { base: "eighth" }, multiple: 2 },
              content: [
                chord([note("regular")], { base: "eighth" }),
                { type: "grace", content: [chord([note("grace")])] },
              ],
            },
          ],
          { staff: 2, voice: 1 },
        ),
      ],
      /ties involving grace notes/,
    );
  });

  it.each([
    { lv: true },
    { targetType: "arpeggio" },
    { targetType: "crossJump" },
    { targetType: "unknown" },
    { side: "auto" },
    { side: "above" },
    { lv: "false" },
    { _x: { viritura: { shape: {} } } },
    { lineType: "dashed" },
  ])("rejects unsupported tie semantics %j", (properties) => {
    const start = note("start");
    start.ties = [{ target: "end", ...properties } as Tie];
    expectRejected([track([chord([start]), chord([note("end")])])], /cannot be exported/);
  });

  it.each([null, "end", 42, []])("rejects a malformed tie %j with a conversion error", (tie) => {
    const start = note("start");
    start.ties = [tie as unknown as Tie];
    expectRejected([track([chord([start]), chord([note("end")])])], /invalid tie/);
  });

  it("rejects a malformed ties list", () => {
    const start = note("start");
    start.ties = {} as Note["ties"];
    expectRejected([track([chord([start])])], /invalid tie list/);
  });

  it.each([true, false])("rejects multiple outgoing ties (same target: %s)", (sameTarget) => {
    const start = note("start");
    start.ties = [{ target: "end" }, { target: sameTarget ? "end" : "other" }];
    expectRejected([track([chord([start]), chord([note("end"), note("other")])])], /multiple outgoing ties/);
  });

  it("rejects multiple incoming ties to one note", () => {
    const first = note("first");
    const second = note("second");
    first.ties = [{ target: "end" }];
    second.ties = [{ target: "end" }];
    expectRejected([track([chord([first]), chord([second]), chord([note("end")])])], /multiple incoming ties/);
  });

  it("rejects reused anonymous tied note objects at multiple locations", () => {
    const start = note();
    start.ties = [{ target: "end" }];
    expectRejected([track([chord([start]), chord([start]), chord([note("end")])])], /multiple outgoing ties/);
  });

  it.each([
    { staff: -1 },
    { voice: 4 },
    { voice: 0.5 },
    { leadIn: [-1, 4] as [number, number] },
    { leadIn: [1, 0] as [number, number] },
  ])("rejects invalid track locations %j", (overrides) => {
    expectRejected([track([chord([note()])], overrides)], /valid staff|negative timing|invalid fraction/);
  });

  it("rejects negative spaces rather than building a backward timeline", () => {
    expectRejected([track([{ type: "space", duration: [-1, 4] }])], /negative timing/);
  });

  it.each([0, -2])("rejects nonpositive tuplet totals (%s)", (multiple) => {
    expectRejected(
      [
        track([
          {
            type: "tuplet",
            inner: { duration: { base: "eighth" }, multiple },
            outer: { duration: { base: "eighth" }, multiple: 2 },
            content: [chord([note()])],
          },
        ]),
      ],
      /tuplet totals must be positive/,
    );
  });
});
