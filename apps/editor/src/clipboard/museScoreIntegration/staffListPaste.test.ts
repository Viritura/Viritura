import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { readMuseScoreClipboard } from "@viritura/musescore-clipboard";
import { applyPaste } from "../../commands/clipboardCommands";
import { partStaffOffset, selectionStaffAnchor } from "../clipboardTrackMapping";

const USER_STAFF_LIST = `<?xml version="1.0" encoding="UTF-8"?>
<StaffList version="4.70" tick="0/1" len="4/4" staff="22" staves="1">
  <Staff id="22">
    <voiceOffset><voice id="0">0</voice></voiceOffset>
    <Harmony><harmonyInfo><name>m</name><root>14</root></harmonyInfo></Harmony>
    <Dynamic><subtype>mf</subtype><velocity>96</velocity></Dynamic>
    <Chord><durationType>eighth</durationType><Note><pitch>75</pitch><tpc>11</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>79</pitch><tpc>15</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>84</pitch><tpc>14</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>86</pitch><tpc>16</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>87</pitch><tpc>11</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>86</pitch><tpc>16</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>84</pitch><tpc>14</tpc></Note></Chord>
    <Chord><durationType>eighth</durationType><Note><pitch>79</pitch><tpc>15</tpc></Note></Chord>
  </Staff>
</StaffList>`;

function destinationScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("MuseScore StaffList paste integration", () => {
  it("applies imported annotations and a whole note of melody atomically", () => {
    const parsed = readMuseScoreClipboard(USER_STAFF_LIST);
    const score = applyPaste(destinationScore(), parsed, 0, 0, 0, 0);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content).toHaveLength(8);
    expect(score.parts[0]!.measures[0]!.chordSymbols?.[0]).toMatchObject({
      root: { step: "C" },
      quality: "minor",
    });

    expect(score.parts[0]!.measures[0]!.dynamics?.[0]).toEqual({
      id: expect.any(String),
      type: "immediate",
      value: "mf",
      staff: 1,
      position: { fraction: [0, 16] },
    });
    const mnx = serializeMnx(score);
    expect(mnx).toHaveProperty("parts.0.measures.0.dynamics", score.parts[0]!.measures[0]!.dynamics);
    expect(parseMnx(mnx).parts[0]!.measures[0]!.dynamics).toEqual(score.parts[0]!.measures[0]!.dynamics);
  });

  it("places imported melody, Cm, and mf on the selected lower destination staff", () => {
    const parsed = readMuseScoreClipboard(USER_STAFF_LIST);
    const score = destinationScore();
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences.push({
      staff: 2,
      content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
    });
    const pasted = applyPaste(score, parsed, 0, 0, 1, 0);
    expect(pasted.parts[0]!.measures[0]!.chordSymbols?.[0]?.displayStaff).toBe(2);
    expect(pasted.parts[0]!.measures[0]!.dynamics?.[0]?.staff).toBe(2);
    expect(pasted.parts[0]!.measures[0]!.sequences[0]).toEqual(score.parts[0]!.measures[0]!.sequences[0]);
  });

  it("keeps primary harmony ownership explicit when StaffList contains multiple voices", () => {
    const xml = USER_STAFF_LIST.replace(
      "</Staff>",
      `<location><voices>1</voices><fractions>-1/1</fractions></location>
       <Chord><durationType>whole</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord></Staff>`,
    );
    const parsed = readMuseScoreClipboard(xml);
    expect(parsed.tracks).toHaveLength(2);
    const pasted = applyPaste(destinationScore(), parsed, 0, 0, 0, 0);
    expect(pasted.parts[0]!.measures[0]!.chordSymbols?.[0]).toMatchObject({
      displayStaff: 1,
      root: { step: "C" },
      quality: "minor",
    });
    expect(pasted.parts[0]!.measures[0]!.dynamics?.[0]).toMatchObject({ staff: 1, value: "mf" });
  });

  it("pastes physical staff, voice, and voiceOffset metadata", () => {
    const xml = `<StaffList version="4.70" tick="0/1" len="1/2" staff="4" staves="2">
      <Staff id="4"><voiceOffset><voice id="0">0</voice></voiceOffset>
      <Chord><durationType>quarter</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord></Staff>
      <Staff id="5"><voiceOffset><voice id="2">480</voice></voiceOffset>
      <location><voices>2</voices></location>
      <Chord><durationType>quarter</durationType><Note><pitch>48</pitch><tpc>14</tpc></Note></Chord></Staff>
    </StaffList>`;
    const parsed = readMuseScoreClipboard(xml);
    const score = destinationScore();
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences = [
      { staff: 1, content: [{ type: "event", duration: { base: "whole" }, rest: {} }] },
      { staff: 2, content: [] },
      { staff: 2, content: [] },
      { staff: 2, content: [{ type: "event", duration: { base: "whole" }, rest: {} }] },
    ];
    const pasted = applyPaste(score, parsed, 0, 0, 0, 0);
    const lowerStaffVoices = pasted.parts[0]!.measures[0]!.sequences.filter((sequence) => sequence.staff === 2);
    expect(lowerStaffVoices[2]!.content).toMatchObject([
      { type: "event", duration: { base: "quarter" }, rest: {} },
      { type: "event", notes: [{ pitch: { step: "C", octave: 3 } }] },
      { type: "event", duration: { base: "half" }, rest: {} },
    ]);
  });

  it("normalizes physical staff offsets to a lower-staff source anchor", () => {
    const score = destinationScore();
    score.parts[0]!.staves = 2;
    score.parts[0]!.measures[0]!.sequences = [
      { staff: 1, content: [] },
      { staff: 2, content: [] },
    ];
    const anchor = selectionStaffAnchor(score, [{ partIndex: 0, measureIndex: 0, sequenceIndex: 1, eventIndex: 0 }]);
    expect(partStaffOffset(score, anchor.partIndex, 0, 2) - anchor.staffOffset).toBe(0);
  });
});
