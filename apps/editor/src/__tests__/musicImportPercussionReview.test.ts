import { describe, expect, it } from "vitest";
import { convertImportedMusicFile } from "../commands/fileCommands";

function percussionXml(partName: string, instrumentSound?: string): string {
  const sound = instrumentSound
    ? `<score-instrument id="i1"><instrument-name>${partName}</instrument-name><instrument-sound>${instrumentSound}</instrument-sound></score-instrument>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>${partName}</part-name>${sound}</score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><clef><sign>percussion</sign></clef></attributes>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure></part>
</score-partwise>`;
}

describe("MusicXML percussion import review", () => {
  it("marks heuristic percussion mappings for interactive review", async () => {
    const file = new File([percussionXml("Percussion")], "ambiguous.musicxml", { type: "application/xml" });
    const result = await convertImportedMusicFile(file);
    expect(result.filename).toBe("ambiguous.mnx");
    expect(result.percussionReviewPartIndices).toEqual([0]);
    expect(result.percussionReviewReasons?.[0]).toContain("inferred from staff position");
  });

  it("loads recognized percussion mappings without review", async () => {
    const file = new File([percussionXml("Wood Block", "wood.wood-block")], "known.xml", {
      type: "application/xml",
    });
    const result = await convertImportedMusicFile(file);
    expect(result.percussionReviewPartIndices).toBeUndefined();
  });
});
