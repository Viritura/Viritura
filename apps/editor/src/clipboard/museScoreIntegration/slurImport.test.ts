import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { walkSequenceEvents, type NoteEvent, type Score, type SequenceContent } from "@viritura/core";
import { parseMnx, serializeMnx, validateRawScore } from "@viritura/format";
import {
  MUSESCORE_STAFF_LIST_MIME,
  readMuseScoreClipboard,
  writeMuseScoreStaffList,
} from "@viritura/musescore-clipboard";
import { applyPaste, copyToClipboard, pasteFromClipboard } from "../../commands/clipboardCommands";
import { buildClipboardSelection } from "../buildClipboardSelection";
import { findPlacedSelection } from "../computePasteResult";
import { deserializeFragment } from "../deserialize";
import { pasteResultFromMuseScore } from "../notationClipboard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@viritura/musescore-clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@viritura/musescore-clipboard")>()),
  writeMuseScoreStaffList: vi.fn(() => {
    throw new Error("Application copy must not invoke the MuseScore exporter");
  }),
}));

// Independently authored from MuseScore 4.7.5 ChordRest and connector serialization:
// https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/engraving/rw/write/twrite.cpp#L1093-L1153
// https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/engraving/rw/write/connectorinfowriter.cpp#L52-L139
const SPLIT_SLUR = `<StaffList version="4.70" tick="7/8" len="1/1" staff="24" staves="1">
  <Staff id="24"><location><fractions>7/8</fractions></location>
    <Chord><durationType>half</durationType>
      <Spanner type="Slur"><Slur><up>down</up><lineType>2</lineType><ticks_f>1/2</ticks_f></Slur>
        <next><location><fractions>1/2</fractions></location></next>
      </Spanner>
      <Note><pitch>60</pitch><tpc>14</tpc></Note>
    </Chord>
    <Chord><durationType>half</durationType>
      <Spanner type="Slur"><prev><location><fractions>-1/2</fractions></location></prev></Spanner>
      <Note><pitch>67</pitch><tpc>15</tpc></Note>
    </Chord>
  </Staff>
</StaffList>`;

const CROSS_STAFF_SLURS = `<StaffList version="4.70" tick="7/8" len="1/2" staff="24" staves="2">
  <Staff id="24"><location><fractions>7/8</fractions></location>
    <Chord><durationType>quarter</durationType>
      <Spanner type="Slur"><Slur/>
        <next><location><fractions>1/4</fractions></location></next>
      </Spanner>
      <Spanner type="Slur"><Slur><up>up</up><lineType>1</lineType></Slur>
        <next><location><staves>1</staves><voices>2</voices><fractions>1/4</fractions></location></next>
      </Spanner>
      <Note><pitch>60</pitch><tpc>14</tpc></Note>
    </Chord>
    <Rest><durationType>quarter</durationType>
      <Spanner type="Slur"><prev><location><fractions>-1/4</fractions></location></prev></Spanner>
    </Rest>
  </Staff>
  <Staff id="25"><location><voices>2</voices><fractions>-1/4</fractions></location>
    <Chord><durationType>quarter</durationType>
      <Spanner type="Slur">
        <prev><location><staves>-1</staves><voices>-2</voices><fractions>-1/4</fractions></location></prev>
      </Spanner>
      <Note><pitch>48</pitch><tpc>14</tpc></Note>
    </Chord>
  </Staff>
</StaffList>`;

function destination(staves = 1): Score {
  const staffBySequence = staves === 1 ? [1] : [1, 2, 2, 2];
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: 4 }, () => ({ time: { count: 4, unit: 4 }, key: { fifths: 0 } })),
    },
    parts: [
      {
        staves,
        measures: Array.from({ length: 4 }, (_, measure) => ({
          sequences: staffBySequence.map((staff, sequence) => ({
            staff,
            content: Array.from({ length: 4 }, (_, event): NoteEvent => ({
              type: "event",
              id: `rest-${measure}-${sequence}-${event}`,
              duration: { base: "quarter" },
              rest: {},
            })),
          })),
        })),
      },
    ],
  };
}

function events(content: SequenceContent[]): NoteEvent[] {
  return [...walkSequenceEvents(content)].map(({ event }) => event);
}

function scoreEvents(score: Score): NoteEvent[] {
  return score.parts.flatMap((part) =>
    part.measures.flatMap((measure) => measure.sequences.flatMap((sequence) => events(sequence.content))),
  );
}

function persist(score: Score): Score {
  const raw = serializeMnx(score);
  expect(validateRawScore(raw)).toMatchObject({ ok: true });
  return parseMnx(JSON.parse(JSON.stringify(raw)));
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("MuseScore slur paste integration", () => {
  it("freshens event targets, keeps the slur on a split onset, and copies the saved result as JSON only", async () => {
    const imported = readMuseScoreClipboard(SPLIT_SLUR, MUSESCORE_STAFF_LIST_MIME);
    const before = structuredClone(imported);
    const paste = pasteResultFromMuseScore(imported);
    const [start, end] = events(paste.content);
    expect(start!.id).not.toBe(events(imported.content)[0]!.id);
    expect(start!.slurs).toEqual([{ target: end!.id, side: "down", sideEnd: "down", lineType: "dashed" }]);
    expect(start!.slurs![0]!.target).not.toBe(end!.notes![0]!.id);

    const target = destination();
    const unchanged = structuredClone(target);
    const score = persist(applyPaste(target, paste, 0, 0, 0, 3));
    const placed = scoreEvents(score).filter((event) => event.notes?.length);
    const [onset, continuation, endpoint] = placed;
    expect(placed).toHaveLength(3);
    expect(onset).toMatchObject({ id: start!.id, duration: { base: "quarter" }, slurs: start!.slurs });
    expect(continuation).toMatchObject({ duration: { base: "quarter" } });
    expect(continuation!.slurs).toBeUndefined();
    expect(onset!.notes![0]!.ties).toEqual([{ target: continuation!.notes![0]!.id }]);
    expect(endpoint!.id).toBe(end!.id);
    expect(score.parts[0]!.measures[1]!.sequences[0]!.content).toContainEqual(endpoint);
    expect(imported).toEqual(before);
    expect(target).toEqual(unchanged);

    const selected = findPlacedSelection(score, placed, 0, 3).selection;
    expect(selected?.kind).toBe("multi");
    const selection = buildClipboardSelection(score, selected!);
    expect(selection).not.toBeNull();
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({ supported: true });
    await expect(copyToClipboard(selection!)).resolves.toBe(true);
    expect(writeMuseScoreStaffList).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("notation_clipboard_write", { text: expect.any(String) });
    const written = vi.mocked(invoke).mock.calls[0]![1] as { text: string };
    const copied = deserializeFragment(written.text)!;
    expect(events(copied.content)[0]!.slurs).toEqual(onset!.slurs);

    vi.mocked(invoke).mockResolvedValue({ text: written.text, museScore: null, supported: true });
    const repaste = await pasteFromClipboard();
    const copiedEvents = events(repaste!.content);
    expect(copiedEvents[0]!.slurs).toEqual([
      { target: copiedEvents[2]!.id, side: "down", sideEnd: "down", lineType: "dashed" },
    ]);
    expect(copiedEvents[2]!.id).not.toBe(endpoint!.id);
  });

  it("retains shared-start slurs to a rest and another staff/voice across repeated pastes and MNX reload", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({
      supported: true,
      text: "",
      museScore: { mime: MUSESCORE_STAFF_LIST_MIME, xml: CROSS_STAFF_SLURS },
    });
    let score = destination(2);
    const pastedIds = new Set<string>();
    for (const measure of [1, 2]) {
      const paste = await pasteFromClipboard();
      expect(paste!.tracks).toHaveLength(2);
      const incoming = paste!.tracks!.flatMap((track) => events(track.content));
      for (const event of incoming) {
        expect(pastedIds.has(event.id!)).toBe(false);
        pastedIds.add(event.id!);
      }
      score = persist(applyPaste(score, paste!, 0, measure, 0, 1));
      const sequences = score.parts[0]!.measures[measure]!.sequences;
      const [start, rest] = incoming;
      const lower = incoming[2]!;
      expect(sequences[0]!.content).toContainEqual(start);
      expect(sequences[0]!.content).toContainEqual(rest);
      expect(sequences[3]).toMatchObject({ staff: 2 });
      expect(sequences[3]!.content).toContainEqual(lower);
      expect(start!.slurs).toEqual([
        { target: rest!.id },
        { target: lower.id, side: "up", sideEnd: "up", lineType: "dotted" },
      ]);
      expect(rest!.rest).toEqual({});
      const savedStart = scoreEvents(score).find((event) => event.id === start!.id)!;
      expect(savedStart.slurs).toEqual(start!.slurs);
      for (const slur of savedStart.slurs!) {
        expect(scoreEvents(score).some((event) => event.id === slur.target)).toBe(true);
      }
    }
    expect(new Set(scoreEvents(score).map((event) => event.id)).size).toBe(scoreEvents(score).length);
    expect(writeMuseScoreStaffList).not.toHaveBeenCalled();
  });

  it("retains slur targets inside tuplets after placement and serialization", () => {
    const xml = SPLIT_SLUR.replace('len="1/1"', 'len="1/2"')
      .replace(
        "<Chord>",
        "<Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>quarter</baseNote></Tuplet><Chord>",
      )
      .replaceAll("<durationType>half</durationType>", "<durationType>quarter</durationType>")
      .replaceAll("1/2</", "1/6</")
      .replace("</Staff>", "<Rest><durationType>quarter</durationType></Rest><endTuplet/></Staff>");
    const paste = pasteResultFromMuseScore(readMuseScoreClipboard(xml));
    const score = persist(applyPaste(destination(), paste, 0, 1, 0, 1));
    const tuplet = score.parts[0]!.measures[1]!.sequences[0]!.content[1]!;
    expect(tuplet.type).toBe("tuplet");
    const [start, end] = events([tuplet]);
    expect(start!.slurs).toEqual([{ target: end!.id, side: "down", sideEnd: "down", lineType: "dashed" }]);
    expect(end!.id).not.toBe(end!.notes![0]!.id);
  });
});
