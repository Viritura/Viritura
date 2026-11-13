import { describe, expect, it } from "vitest";
import { partShowsChordSymbols, type Score } from "@viritura/core";
import { parseMnx, serializeMnx, validateRawScore } from "@viritura/format";
import { convertMusicXmlToMnx } from "@viritura/musicxml";
import { enrichInstrumentIdentities } from "../InstrumentCatalog";
import { extractPlayersFromScore } from "../instrumentMutations";

describe("instrument identity enrichment", () => {
  it("preserves explicit identities and user-supplied playback metadata", () => {
    const score: Score = {
      global: { measures: [{}] },
      parts: [
        {
          name: "Trumpet",
          measures: [],
          _x: { viritura: { instrumentId: "keyboard.piano", midiProgram: 5, family: "custom" } },
        },
        { name: "Piano", measures: [], _x: { viritura: { instrumentId: "custom.zither" } } },
      ],
    };
    const original = structuredClone(score);
    expect(enrichInstrumentIdentities(score)).toBe(0);
    expect(score).toEqual(original);
  });

  it("uses MusicXML sound identities rather than exporter-specific display names", () => {
    const instruments = [
      { name: "Clarinet in Bb 1", id: "wind.reed.clarinet.bflat", diatonic: -1, chromatic: -2, octave: 0, program: 71 },
      { name: "Trumpet in Bb 2", id: "brass.trumpet.bflat", diatonic: -1, chromatic: -2, octave: 0, program: 56 },
      { name: "Horn in F 1 &amp; 3", id: "brass.french-horn", diatonic: -4, chromatic: -7, octave: 0, program: 60 },
      {
        name: "Baritone Saxophone",
        id: "wind.reed.saxophone.baritone",
        diatonic: -5,
        chromatic: -9,
        octave: -1,
        program: 67,
      },
    ];
    const xml = `<score-partwise version="4.0"><defaults><concert-score/></defaults><part-list>
      ${instruments
        .map(
          (inst, i) => `<score-part id="P${i}"><part-name>${inst.name}</part-name>
        <score-instrument id="I${i}"><instrument-name>Instrument</instrument-name>
          <instrument-sound>${inst.id}</instrument-sound></score-instrument></score-part>`,
        )
        .join("")}
      </part-list>${instruments
        .map(
          (inst, i) => `<part id="P${i}"><measure number="1"><attributes>
        <divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <for-part><part-transpose><diatonic>${inst.diatonic}</diatonic><chromatic>${inst.chromatic}</chromatic>
          <octave-change>${inst.octave}</octave-change></part-transpose></for-part>
        </attributes><note><rest/><duration>4</duration><type>whole</type></note>
      </measure></part>`,
        )
        .join("")}</score-partwise>`;
    const raw = convertMusicXmlToMnx(xml, { includeVendorExtensions: true });
    expect(validateRawScore(raw).ok).toBe(true);
    const score = parseMnx(raw);
    expect(enrichInstrumentIdentities(score)).toBe(4);
    expect(score.parts.map((part) => part._x?.viritura?.instrumentId)).toEqual(instruments.map((inst) => inst.id));
    expect(score.parts.map((part) => part._x?.viritura?.midiProgram)).toEqual(instruments.map((inst) => inst.program));
    expect(score.parts.map((part) => part._x?.viritura?.family)).toEqual(["woodwinds", "brass", "brass", "woodwinds"]);
    expect(extractPlayersFromScore(score).map((player) => player.instrumentId)).toEqual(
      instruments.map((inst) => inst.id),
    );
    expect(score.parts.map((part) => part.transposition?.interval.halfSteps)).toEqual([2, 2, 7, 21]);
    expect(enrichInstrumentIdentities(score)).toBe(0);
    expect(validateRawScore(serializeMnx(score)).ok).toBe(true);
  });

  it("uses a declared initial instrument before guessing from the part name", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [
        {
          name: "Flute",
          measures: [],
          _x: {
            viritura: {
              initialInstrument: "guitar",
              instruments: { guitar: { instrumentId: "pluck.guitar" } },
            },
          },
        },
        {
          name: "Piano",
          measures: [],
          _x: {
            viritura: {
              initialInstrument: "custom",
              instruments: { custom: { instrumentId: "custom.zither" } },
            },
          },
        },
        { name: "Piano", measures: [] },
      ],
    };

    expect(enrichInstrumentIdentities(score)).toBe(3);
    expect(score.parts.map((part) => part._x?.viritura?.instrumentId)).toEqual([
      "pluck.guitar",
      "custom.zither",
      "keyboard.piano",
    ]);
    expect(score.parts.map(partShowsChordSymbols)).toEqual([true, false, true]);
    expect(validateRawScore(serializeMnx(score)).ok).toBe(true);
    expect(enrichInstrumentIdentities(score)).toBe(0);
  });
});
