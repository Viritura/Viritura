// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { NoteEvent, SequenceContent } from "@viritura/core";
import type { MuseScoreClipboardWriteInput, MuseScoreClipboardDynamic } from ".";
import { MuseScoreConversionError, readMuseScoreClipboard, writeMuseScoreStaffList } from ".";

function start(type = "Tie", delta = "1/4", fields = "", properties = ""): string {
  return (
    `<Spanner type="${type}"><${type}>${properties}<ticks_f>${delta}</ticks_f></${type}>` +
    `<next><location><fractions>${delta}</fractions>${fields}</location></next></Spanner>`
  );
}

function end(type = "Tie", delta = "-1/4", fields = ""): string {
  return `<Spanner type="${type}"><prev><location><fractions>${delta}</fractions>${fields}</location></prev></Spanner>`;
}

function note(connectors = "", midi = 60, tpc = 14): string {
  return `<Note>${connectors}<pitch>${midi}</pitch><tpc>${tpc}</tpc></Note>`;
}

function chord(notes = note(), duration = "quarter"): string {
  return `<Chord><durationType>${duration}</durationType>${notes}</Chord>`;
}

function staffList(content: string, length = "1/2", tick = "0/1"): string {
  return (
    `<StaffList version="4.70" tick="${tick}" len="${length}" staff="24" staves="1"><Staff id="24">` +
    `<location><fractions>${tick}</fractions></location>${content}</Staff></StaffList>`
  );
}

function events(content: readonly SequenceContent[]): NoteEvent[] {
  return content.flatMap((item): NoteEvent[] =>
    item.type === "event" ? [item] : item.type === "tuplet" || item.type === "grace" ? events(item.content) : [],
  );
}

function xmlChordNotes(xml: string): Element[][] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(document.querySelectorAll("Chord"), (element) => Array.from(element.querySelectorAll("Note")));
}

function selection(parsed: ReturnType<typeof readMuseScoreClipboard>): MuseScoreClipboardWriteInput {
  return { ...parsed, events: parsed.content };
}

function expectInvalid(xml: string, message: RegExp): void {
  expect(() => readMuseScoreClipboard(xml)).toThrow(MuseScoreConversionError);
  expect(() => readMuseScoreClipboard(xml)).toThrow(message);
}

describe("relative Tie import and public export", () => {
  it("registers connectors before pitch and uses absolute-root-normalized onset deltas, not note durations", () => {
    const parsed = readMuseScoreClipboard(
      staffList(
        chord(note(start("Tie", "1/2"))) +
          "<Rest><durationType>quarter</durationType></Rest>" +
          chord(note(end("Tie", "-1/2")), "eighth"),
        "5/8",
        "5/1",
      ),
    );
    const notes = events(parsed.content);
    expect(notes[0]!.notes![0]!.ties).toEqual([{ target: notes[2]!.notes![0]!.id }]);
    const before = JSON.stringify(parsed);
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.warning).toBeUndefined();
    expect(result.xml).toContain(start("Tie", "1/2"));
    expect(result.xml).toContain(end("Tie", "-1/2"));
    expect(JSON.stringify(parsed)).toBe(before);
    const again = events(readMuseScoreClipboard(result.xml!).content);
    expect(again[0]!.notes![0]!.ties?.[0]?.target).toBe(again[2]!.notes![0]!.id);
  });

  it("imports repeated-pitch chord ordinals and a tie chain but rejects their re-export", () => {
    const parsed = readMuseScoreClipboard(
      staffList(
        chord(note(start("Tie", "1/4", "<notes>1</notes>")) + note(start("Tie", "1/4", "<notes>-1</notes>"))) +
          chord(
            note(end("Tie", "-1/4", "<notes>1</notes>")) + note(start() + end("Tie", "-1/4", "<notes>-1</notes>")),
          ) +
          chord(note() + note(end())),
        "3/4",
      ),
    );
    const [a, b, c] = events(parsed.content);
    expect(a!.notes![0]!.ties?.[0]?.target).toBe(b!.notes![1]!.id);
    expect(a!.notes![1]!.ties?.[0]?.target).toBe(b!.notes![0]!.id);
    expect(b!.notes![1]!.ties?.[0]?.target).toBe(c!.notes![1]!.id);
    const before = JSON.stringify(parsed);
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.xml).toBeNull();
    expect(result.warning).toMatch(/unison-chord ties/);
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("uses actual multiplied nested-tuplet timing for both endpoints", () => {
    const tuplet = (base: string): string =>
      `<Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>${base}</baseNote></Tuplet>`;
    const parsed = readMuseScoreClipboard(
      staffList(
        tuplet("eighth") +
          chord(note(), "eighth") +
          tuplet("16th") +
          chord(note(start("Tie", "1/36")), "16th") +
          chord(note(end("Tie", "-1/36")), "16th") +
          chord(note(), "16th") +
          "<endTuplet/>" +
          chord(note(), "eighth") +
          "<endTuplet/>",
        "1/4",
      ),
    );
    const notes = events(parsed.content);
    expect(notes[1]!.notes![0]!.ties?.[0]?.target).toBe(notes[2]!.notes![0]!.id);
    const written = writeMuseScoreStaffList(selection(parsed));
    expect(written.warning).toBeUndefined();
    expect(written.xml).toContain("<ticks_f>1/36</ticks_f>");
    expect(written.xml).toContain("<fractions>-1/36</fractions>");
    expect(readMuseScoreClipboard(written.xml!).content[0]!.type).toBe("tuplet");
  });

  it("imports the second of three native C4 unisons tied to a singleton using source indices -1/+1", () => {
    // MuseScore 4.7.5, 3654226c2e99289916916953a98e585a3d3b315a:
    // dom/location.cpp Location::note and rw/write/twrite.cpp TWrite::write(Chord*)
    // use the same source notes() vector. This literal is independent of our writer.
    const xml = `<StaffList version="4.70" tick="0/1" len="1/2" staff="24" staves="1">
      <Staff id="24">
        <Chord><durationType>quarter</durationType>
          <Note><pitch>60</pitch><tpc>14</tpc></Note>
          <Note>
            <Spanner type="Tie"><Tie><ticks_f>1/4</ticks_f></Tie>
              <next><location><fractions>1/4</fractions><notes>-1</notes></location></next>
            </Spanner>
            <pitch>60</pitch><tpc>14</tpc>
          </Note>
          <Note><pitch>60</pitch><tpc>14</tpc></Note>
        </Chord>
        <Chord><durationType>quarter</durationType>
          <Note>
            <Spanner type="Tie">
              <prev><location><fractions>-1/4</fractions><notes>1</notes></location></prev>
            </Spanner>
            <pitch>60</pitch><tpc>14</tpc>
          </Note>
        </Chord>
      </Staff>
    </StaffList>`;
    const parsed = readMuseScoreClipboard(xml);
    const [from, to] = events(parsed.content);
    expect(from!.notes!.map((item) => item.pitch)).toEqual(Array(3).fill({ step: "C", octave: 4 }));
    expect(from!.notes![0]!.ties).toBeUndefined();
    expect(from!.notes![1]!.ties).toEqual([{ target: to!.notes![0]!.id }]);
    expect(from!.notes![2]!.ties).toBeUndefined();

    const before = JSON.stringify(parsed);
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.xml).toBeNull();
    expect(result.warning).toMatch(/unison-chord ties/);
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("imports a singleton tied to the second native destination unison, not the last one", () => {
    const parsed = readMuseScoreClipboard(
      staffList(
        chord(note(start("Tie", "1/4", "<notes>1</notes>"))) +
          chord(note() + note(end("Tie", "-1/4", "<notes>-1</notes>")) + note()),
      ),
    );
    const [from, to] = events(parsed.content);
    expect(from!.notes![0]!.ties).toEqual([{ target: to!.notes![1]!.id }]);
    expect(from!.notes![0]!.ties![0]!.target).not.toBe(to!.notes![2]!.id);
    const before = JSON.stringify(parsed);
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.xml).toBeNull();
    expect(result.warning).toMatch(/unison-chord ties/);
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it.each([
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ])("imports native three-unison ordinals [%i, %i, %i] but rejects re-export", (...targets) => {
    const from = targets.map((target, index) => note(start("Tie", "1/4", `<notes>${target - index}</notes>`)));
    const to = targets.map((_, index) => note(end("Tie", "-1/4", `<notes>${targets.indexOf(index) - index}</notes>`)));
    const parsed = readMuseScoreClipboard(staffList(chord(from.join("")) + chord(to.join(""))));
    const [source, destination] = events(parsed.content);
    expect(source!.notes!.map((item) => item.ties?.[0]?.target)).toEqual(
      targets.map((target) => destination!.notes![target]!.id),
    );
    const before = JSON.stringify(parsed);
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.xml).toBeNull();
    expect(result.warning).toMatch(/unison-chord ties/);
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("imports unsorted triads containing three repeated pitches by source ordinal but rejects re-export", () => {
    // Source XML ordinals, not ascending-pitch ranks: C[2] -> C[4], E[0] -> E[1],
    // G[3] -> G[0]. Import preserves these identities; unison-chord ties cannot be exported safely.
    const parsed = readMuseScoreClipboard(
      staffList(
        chord(
          note(start("Tie", "1/4", "<notes>1</notes>"), 64, 18) +
            note() +
            note(start("Tie", "1/4", "<notes>2</notes>")) +
            note(start("Tie", "1/4", "<notes>-3</notes>"), 67, 15) +
            note(),
        ) +
          chord(
            note(end("Tie", "-1/4", "<notes>3</notes>"), 67, 15) +
              note(end("Tie", "-1/4", "<notes>-1</notes>"), 64, 18) +
              note() +
              note() +
              note(end("Tie", "-1/4", "<notes>-2</notes>")),
          ),
      ),
    );
    const [from, to] = events(parsed.content);
    expect(from!.notes![2]!.ties).toEqual([{ target: to!.notes![4]!.id }]);
    expect(from!.notes![0]!.ties).toEqual([{ target: to!.notes![1]!.id }]);
    expect(from!.notes![3]!.ties).toEqual([{ target: to!.notes![0]!.id }]);
    const before = JSON.stringify(parsed);
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.xml).toBeNull();
    expect(result.warning).toMatch(/unison-chord ties/);
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("exports untied duplicate-pitch chords without mutation", () => {
    const parsed = readMuseScoreClipboard(staffList(chord(note() + note() + note()), "1/4"));
    const before = JSON.stringify(parsed);
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.warning).toBeUndefined();
    expect(result.xml).not.toBeNull();
    const [written] = xmlChordNotes(result.xml!);
    expect(written!.map((element) => element.querySelector("pitch")?.textContent)).toEqual(["60", "60", "60"]);
    expect(result.xml).not.toContain("<Spanner");
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("exports unsorted distinct-pitch triads with connector indices matching the sorted notes", () => {
    const parsed = readMuseScoreClipboard(
      staffList(
        chord(
          note(start("Tie", "1/4", "<notes>1</notes>"), 64, 18) +
            note() +
            note(start("Tie", "1/4", "<notes>-2</notes>"), 67, 15),
        ) +
          chord(
            note(end("Tie", "-1/4", "<notes>2</notes>"), 67, 15) +
              note(end("Tie", "-1/4", "<notes>-1</notes>"), 64, 18) +
              note("", 71, 19),
          ),
      ),
    );
    const [from, to] = events(parsed.content);
    expect(from!.notes![0]!.ties).toEqual([{ target: to!.notes![1]!.id }]);
    expect(from!.notes![1]!.ties).toBeUndefined();
    expect(from!.notes![2]!.ties).toEqual([{ target: to!.notes![0]!.id }]);
    const before = JSON.stringify(parsed);
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.warning).toBeUndefined();
    expect(result.xml).not.toBeNull();
    expect(JSON.stringify(parsed)).toBe(before);
    const [writtenFrom, writtenTo] = xmlChordNotes(result.xml!);
    expect(writtenFrom!.map((element) => element.querySelector("pitch")?.textContent)).toEqual(["60", "64", "67"]);
    expect(writtenTo!.map((element) => element.querySelector("pitch")?.textContent)).toEqual(["64", "67", "71"]);
    expect(writtenFrom![0]!.querySelector("Spanner")).toBeNull();
    expect(writtenTo![2]!.querySelector("Spanner")).toBeNull();
    const [againFrom, againTo] = events(readMuseScoreClipboard(result.xml!).content);
    for (const [source, target] of [
      [1, 0],
      [2, 1],
    ] as const) {
      expect(writtenFrom![source]!.querySelector("next notes")?.textContent).toBe("-1");
      expect(writtenTo![target]!.querySelector("prev notes")?.textContent).toBe("1");
      expect(againFrom!.notes![source]!.ties).toEqual([{ target: againTo!.notes![target]!.id }]);
    }
    expect(againFrom!.notes![0]!.ties).toBeUndefined();
  });

  it("pairs cross-staff/voice ties independently of stream order and resets only staff/voice cursors", () => {
    const xml =
      `<StaffList version="4.70" tick="7/1" len="1/2" staff="24" staves="2">` +
      `<Staff id="24"><location><voices>3</voices><fractions>7/1</fractions></location>` +
      chord(note(start("Tie", "1/4", "<staves>1</staves><voices>-3</voices>"))) +
      "</Staff>" +
      `<Staff id="25">${chord(note(end("Tie", "-1/4", "<staves>-1</staves><voices>3</voices>")))}</Staff></StaffList>`;
    const parsed = readMuseScoreClipboard(xml);
    const source = events(parsed.tracks![0]!.content)[0]!.notes![0]!;
    const target = events(parsed.tracks![1]!.content)[0]!.notes![0]!;
    expect(source.ties).toEqual([{ target: target.id, targetType: "crossVoice" }]);
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.warning).toBeUndefined();
    expect(result.xml).toContain("<staves>1</staves><voices>-3</voices><fractions>1/4</fractions>");
    const again = readMuseScoreClipboard(result.xml!);
    expect(events(again.tracks![0]!.content)[0]!.notes![0]!.ties?.[0]?.target).toBe(
      events(again.tracks![1]!.content)[0]!.notes![0]!.id,
    );
  });

  it("allows optional ticks_f and preserves up/down tie placement", () => {
    const parsed = readMuseScoreClipboard(
      staffList(
        chord(note(start("Tie", "1/4", "", "<up>down</up>").replace("<ticks_f>1/4</ticks_f>", ""))) +
          chord(note(end())),
      ),
    );
    expect(events(parsed.content)[0]!.notes![0]!.ties?.[0]?.side).toBe("down");
    expect(writeMuseScoreStaffList(selection(parsed)).xml).toContain("<up>down</up><ticks_f>1/4</ticks_f>");
  });

  it.each([
    ["orphan start", start(), "", /orphan/],
    ["orphan end", "", end(), /orphan/],
    ["nonreciprocal", start(), end("Tie", "-1/8"), /reciprocal/],
    ["duplicate starts", start() + start(), end(), /ambiguous/],
    ["duplicate ends", start(), end() + end(), /ambiguous/],
    ["missing location", start().replace(/<location>.*<\/location>/, ""), end(), /missing location/],
    ["both directions", start().replace("</Spanner>", "<prev><location/></prev></Spanner>"), end(), /exactly one/],
    ["missing body", start().replace(/<Tie>.*<\/Tie>/, ""), end(), /body/],
    ["body on end", start(), end().replace("<prev>", "<Tie/><prev>"), /body/],
    ["wrong ticks", start().replace("<ticks_f>1/4", "<ticks_f>1/8"), end(), /ticks_f/],
    ["zero duration", start("Tie", "0/1"), end("Tie", "0/1"), /orphan/],
    ["invalid fraction", start("Tie", "bad"), end(), /invalid fraction/],
    ["zero denominator", start("Tie", "1/0"), end(), /invalid fraction/],
    ["unknown location", start("Tie", "1/4", "<foo>0</foo>"), end(), /property/],
    ["duplicate fraction", start("Tie", "1/4", "<fractions>1/4</fractions>"), end(), /duplicate/],
    ["invalid notes", start("Tie", "1/4", "<notes>0.5</notes>"), end(), /invalid notes/],
    ["outside note ordinal", start("Tie", "1/4", "<notes>1</notes>"), end(), /orphan/],
    ["negative note ordinal", start("Tie", "1/4", "<notes>-1</notes>"), end(), /outside/],
    ["outside staff", start("Tie", "1/4", "<staves>1</staves>"), end(), /outside/],
    ["outside voice", start("Tie", "1/4", "<voices>4</voices>"), end(), /outside/],
    ["outside selection", start("Tie", "3/4"), end(), /outside/],
    ["measure anchors", start("Tie", "1/4", "<measures>1</measures>"), end(), /measure/],
    ["grace anchors", start("Tie", "1/4", "<grace>0</grace>"), end(), /grace/],
    ["unknown body property", start("Tie", "1/4", "", "<bogus/>"), end(), /property/],
    ["nested ticks", start().replace("<ticks_f>1/4</ticks_f>", "<ticks_f><x>1/4</x></ticks_f>"), end(), /nested/],
    [
      "nested fraction",
      start().replace("<fractions>1/4</fractions>", "<fractions><Slur/>1/4</fractions>"),
      end(),
      /nested/,
    ],
    ["slur", start("Slur"), end("Slur"), /Slur/],
  ])("rejects %s without fabricating ties", (_name, from, to, message) => {
    expectInvalid(staffList(chord(note(from)) + chord(note(to))), message as RegExp);
  });

  it("rejects cross-pitch reciprocal ties", () => {
    expectInvalid(staffList(chord(note(start())) + chord(note(end(), 62, 16))), /same MIDI pitch/);
  });

  it("explicitly rejects ties attached to grace notes or single-note symbols", () => {
    expectInvalid(
      staffList(chord(note(start())).replace("<Note>", "<acciaccatura/><Note>") + chord(note(end()))),
      /grace/,
    );
    expectInvalid(`<EngravingItem>${note(start())}</EngravingItem>`, /complete StaffList/);
  });

  it("retains unsupported percussion and slur export rejection", () => {
    const base = selection(readMuseScoreClipboard(staffList(chord() + chord())));
    const first = events(base.events)[0]!;
    first.slurs = [{ target: "elsewhere" }];
    expect(writeMuseScoreStaffList(base).warning).toMatch(/slurs/);
    delete first.slurs;
    first.kitNotes = [{ kitComponent: "snare" }];
    expect(writeMuseScoreStaffList(base).warning).toMatch(/percussion/);
  });
});

describe("relative HairPin import and export", () => {
  const mf = "<Dynamic><subtype>mf</subtype><velocity>80</velocity></Dynamic>";
  const span = (body = mf, subtype = 0): string =>
    staffList(
      body +
        start("HairPin", "3/4", "", `<subtype>${subtype}</subtype>`) +
        chord(note(), "half") +
        chord() +
        end("HairPin", "-3/4"),
      "3/4",
      "2/1",
    );

  it.each([0, 1])(
    "absorbs coincident mf as the gradual start and retains the exact selection-end endpoint (%i)",
    (subtype) => {
      const parsed = readMuseScoreClipboard(span(mf, subtype));
      expect(parsed.dynamics).toHaveLength(1);
      expect(parsed.dynamics![0]).toEqual({
        offset: [0, 1],
        endOffset: [3, 4],
        measureOffset: 0,
        endMeasureOffset: 0,
        staffOffset: 0,
        dynamic: {
          id: expect.any(String),
          type: "gradual",
          value: "mf",
          wedgeType: subtype === 0 ? "increasing" : "decreasing",
          position: { fraction: [0, 1] },
          end: { measure: "0", position: { fraction: [3, 4] } },
        },
      });
      const before = JSON.stringify(parsed);
      const result = writeMuseScoreStaffList(selection(parsed));
      expect(result.warning).toBeUndefined();
      expect(result.xml!.match(/<Dynamic>/g)).toHaveLength(1);
      expect(result.xml).toContain("<Dynamic><subtype>mf</subtype></Dynamic>");
      expect(result.xml).not.toContain("<velocity>");
      expect(result.xml!.match(/<Spanner type="HairPin">/g)).toHaveLength(2);
      expect(result.xml).toContain("<ticks_f>3/4</ticks_f>");
      expect(result.xml).toContain("<fractions>-3/4</fractions>");
      const again = readMuseScoreClipboard(result.xml!);
      expect(again.dynamics).toHaveLength(1);
      expect(again.dynamics![0]).toEqual({
        ...parsed.dynamics![0],
        dynamic: { ...parsed.dynamics![0]!.dynamic, id: expect.any(String) },
      });
      expect(JSON.stringify(parsed)).toBe(before);
    },
  );

  it("leaves an unmarked start at the current level rather than inventing mf", () => {
    const parsed = readMuseScoreClipboard(span(""));
    expect(parsed.dynamics![0]!.dynamic).toEqual({
      id: expect.any(String),
      type: "gradual",
      wedgeType: "increasing",
      position: { fraction: [0, 1] },
      end: { measure: "0", position: { fraction: [3, 4] } },
    });
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.warning).toBeUndefined();
    expect(result.xml).not.toContain("<Dynamic>");
  });

  it("retains endpoint dynamics and resolves a start Dynamic serialized after the hairpin", () => {
    const xml = staffList(
      start("HairPin", "1/4") +
        mf +
        chord() +
        end("HairPin") +
        "<Dynamic><subtype>f</subtype><velocity>96</velocity></Dynamic>" +
        chord(),
    );
    const parsed = readMuseScoreClipboard(xml);
    expect(parsed.dynamics).toHaveLength(2);
    expect(parsed.dynamics![0]!.dynamic).toEqual({
      id: expect.any(String),
      type: "gradual",
      value: "mf",
      wedgeType: "increasing",
      position: { fraction: [0, 1] },
      end: { measure: "0", position: { fraction: [1, 4] } },
    });
    expect(parsed.dynamics![1]).toEqual({
      partOffset: 0,
      staffOffset: 0,
      measureOffset: 0,
      offset: [1, 4],
      dynamic: {
        id: expect.any(String),
        type: "immediate",
        value: "f",
        position: { fraction: [0, 1] },
      },
    });
  });

  it("absorbs an all-voices current dynamic when its staff-stream voice differs", () => {
    const parsed = readMuseScoreClipboard(
      staffList(
        mf +
          "<location><voices>1</voices></location>" +
          start("HairPin", "1/2") +
          chord(note(), "half") +
          end("HairPin", "-1/2"),
      ),
    );
    expect(parsed.dynamics).toHaveLength(1);
    expect(parsed.dynamics![0]!.dynamic).toEqual({
      id: expect.any(String),
      type: "gradual",
      value: "mf",
      wedgeType: "increasing",
      position: { fraction: [0, 1] },
      end: { measure: "0", position: { fraction: [1, 2] } },
    });
  });

  it("coalesces identical native immediate/current start markings and rejects conflicting ones", () => {
    const parsed = readMuseScoreClipboard(span());
    const immediate: MuseScoreClipboardDynamic = {
      measureOffset: 0,
      offset: [0, 1],
      dynamic: {
        id: "immediate",
        type: "immediate",
        value: "mf",
        position: { fraction: [0, 1] },
      },
    };
    parsed.dynamics!.push(immediate);
    const before = JSON.stringify(parsed);
    const written = writeMuseScoreStaffList(selection(parsed));
    expect(written.warning).toBeUndefined();
    expect(written.xml!.match(/<Dynamic>/g)).toHaveLength(1);
    expect(written.xml).toContain("<Dynamic><subtype>mf</subtype></Dynamic>");
    expect(written.xml).not.toContain("<velocity>");
    expect(readMuseScoreClipboard(written.xml!).dynamics).toHaveLength(1);
    expect(JSON.stringify(parsed)).toBe(before);
    immediate.dynamic.value = "f";
    expect(writeMuseScoreStaffList(selection(parsed)).warning).toMatch(/conflicting coincident/);
  });

  it("exports cross-bar captured endOffset without interpreting opaque source measure IDs", () => {
    const parsed = readMuseScoreClipboard(
      staffList(
        chord(note(), "whole") +
          chord(note(), "half") +
          "<location><fractions>-1/1</fractions></location>" +
          start("HairPin", "1/1") +
          "<location><fractions>1/1</fractions></location>" +
          end("HairPin", "-1/1"),
        "3/2",
        "9/1",
      ),
    );
    const capture = parsed.dynamics![0]!;
    capture.measureOffset = 2;
    capture.endMeasureOffset = 4;
    capture.dynamic.position.fraction = [1, 4];
    capture.dynamic.end = { measure: "opaque-end", position: { fraction: [1, 8] } };
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.warning).toBeUndefined();
    const again = readMuseScoreClipboard(result.xml!);
    expect(again.dynamics![0]).toMatchObject({ offset: [1, 2], endOffset: [3, 2] });
    expect(result.xml).toContain("<ticks_f>1/1</ticks_f>");
  });

  it("reconstructs only explicitly same-measure endpoints when endOffset is absent", () => {
    const parsed = readMuseScoreClipboard(span());
    const capture = parsed.dynamics![0]!;
    delete capture.endOffset;
    expect(writeMuseScoreStaffList(selection(parsed)).warning).toBeUndefined();
    capture.endMeasureOffset = 1;
    expect(writeMuseScoreStaffList(selection(parsed)).warning).toMatch(/endOffset/);
  });

  it("roundtrips independent hairpins on a secondary physical staff", () => {
    const parsed = readMuseScoreClipboard(
      `<StaffList version="4.70" tick="0/1" len="1/2" staff="24" staves="2">` +
        `<Staff id="24">${chord(note(), "half")}</Staff><Staff id="25">` +
        "<location><fractions>-1/2</fractions></location>" +
        start("HairPin", "1/2") +
        chord(note(), "half") +
        end("HairPin", "-1/2") +
        "</Staff></StaffList>",
    );
    expect(parsed.dynamics![0]!.staffOffset).toBe(1);
    const result = writeMuseScoreStaffList(selection(parsed));
    expect(result.warning).toBeUndefined();
    expect(readMuseScoreClipboard(result.xml!).dynamics![0]!.staffOffset).toBe(1);
  });

  it("checks hairpin containment against every copied track, not just already serialized ones", () => {
    const parsed = readMuseScoreClipboard(span(""));
    parsed.dynamics![0]!.staffOffset = 1;
    const value = selection(parsed);
    value.tracks = [
      {
        partOffset: 0,
        voiceIndex: 0,
        staffOffset: 0,
        content: [{ type: "event", duration: { base: "quarter" }, rest: {} }],
      },
      { partOffset: 0, voiceIndex: 0, staffOffset: 1, content: parsed.content },
    ];
    value.dynamics!.push({
      measureOffset: 0,
      staffOffset: 0,
      offset: [0, 1],
      dynamic: { id: "current", type: "immediate", value: "mf", position: { fraction: [0, 1] } },
    });
    const result = writeMuseScoreStaffList(value);
    expect(result.warning).toBeUndefined();
    expect(result.xml).toContain('len="3/4"');
    expect(
      readMuseScoreClipboard(result.xml!).dynamics!.find((capture) => capture.dynamic.type === "gradual"),
    ).toMatchObject({ staffOffset: 1, endOffset: [3, 4] });
  });

  it.each([
    ["orphan", start("HairPin"), /orphan/],
    ["duplicate", start("HairPin") + start("HairPin") + chord() + end("HairPin"), /ambiguous/],
    ["zero span", start("HairPin", "0/1") + end("HairPin", "0/1"), /strictly later/],
    ["negative span", end("HairPin", "1/4") + chord() + start("HairPin", "-1/4"), /strictly later/],
    ["outside selection", start("HairPin", "1/1"), /outside/],
    ["note anchor", start("HairPin", "1/4", "<notes>1</notes>"), /note-index/],
    ["unsupported subtype", start("HairPin", "1/4", "", "<subtype>2</subtype>") + chord() + end("HairPin"), /subtype/],
    [
      "nested subtype",
      start("HairPin", "1/4", "", "<subtype><subtype>0</subtype><subtype>1</subtype></subtype>") +
        chord() +
        end("HairPin"),
      /nested/,
    ],
    ["duplicate dynamics", mf + mf + start("HairPin") + chord() + end("HairPin"), /ambiguous/],
    [
      "crossvoice",
      start("HairPin", "1/4", "<voices>1</voices>") +
        chord() +
        "<location><voices>1</voices></location>" +
        end("HairPin", "-1/4", "<voices>-1</voices>"),
      /cross-voice/,
    ],
    ["unknown spanner", start("Slur") + chord() + end("Slur"), /Slur/],
  ])("rejects %s HairPin connectors gracefully", (_name, body, message) => {
    expectInvalid(staffList(body), message as RegExp);
  });

  it("rejects outward and duplicate export endpoints rather than extending the selection or creating ambiguity", () => {
    const parsed = readMuseScoreClipboard(span());
    const capture = parsed.dynamics![0]!;
    capture.endOffset = [1, 1];
    expect(writeMuseScoreStaffList(selection(parsed)).warning).toMatch(/outside/);
    capture.endOffset = [3, 4];
    parsed.dynamics!.push({ ...capture, dynamic: { ...capture.dynamic, id: "duplicate" } });
    expect(writeMuseScoreStaffList(selection(parsed)).warning).toMatch(/duplicate/);
  });

  it("deduplicates mirrored gradual captures without losing their endpoint", () => {
    const parsed = readMuseScoreClipboard(span());
    const value = selection(parsed);
    value.tracks = [{ partOffset: 0, voiceIndex: 0, content: value.events, dynamics: parsed.dynamics }];
    const result = writeMuseScoreStaffList(value);
    expect(result.warning).toBeUndefined();
    expect(result.xml!.match(/<Spanner type="HairPin">/g)).toHaveLength(2);
    value.tracks[0]!.dynamics = [{ ...parsed.dynamics![0]!, endOffset: [1, 2] }];
    expect(writeMuseScoreStaffList(value).warning).toMatch(/conflicting captures/);
  });
});
