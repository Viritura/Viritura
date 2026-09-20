import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convertImportedMusicFile } from "../commands/fileCommands";
import { useImportSettingsStore } from "../store/importSettingsStore";

function score(harmonies: string): string {
  return `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
    <part id="P1"><measure number="1">
      <attributes><divisions>1</divisions><staves>2</staves></attributes>
      ${harmonies}
      <note><rest/><duration>4</duration><type>whole</type></note>
    </measure></part>
  </score-partwise>`;
}

async function sourceFile(xml: string, extension: string): Promise<File> {
  if (extension !== "mxl") return new File([xml], `score.${extension}`);
  const zip = new JSZip();
  zip.file("score.xml", xml);
  return new File([await zip.generateAsync({ type: "arraybuffer" })], "score.mxl");
}

const originalSettings = useImportSettingsStore.getState();
beforeEach(() => {
  useImportSettingsStore.setState({ includeVendorExtensions: true });
});
afterEach(() => {
  useImportSettingsStore.setState(originalSettings);
});

describe.each(["musicxml", "xml", "mxl"])("%s source diagnostic propagation", (extension) => {
  it("retains unsupported chord text warnings from the source converter", async () => {
    const xml = score('<harmony><root><root-step>C</root-step></root><kind text="Mystery">major</kind></harmony>');
    const result = await convertImportedMusicFile(await sourceFile(xml, extension));
    expect(result.importDiagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "musicxml-harmony-kind",
        message: expect.stringContaining("Unsupported"),
      }),
    ]);
  });

  it("retains conflicting source staff harmony warnings", async () => {
    const xml = score(`
      <harmony><root><root-step>C</root-step></root><kind>major</kind><staff>1</staff></harmony>
      <harmony><root><root-step>D</root-step></root><kind>minor</kind><staff>2</staff></harmony>`);
    const result = await convertImportedMusicFile(await sourceFile(xml, extension));
    expect(result.importDiagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "musicxml-harmony-conflict",
        message: expect.stringContaining("kept the topmost source staff"),
      }),
    ]);
  });

  it("does not attach diagnostic noise to a lossless import", async () => {
    const result = await convertImportedMusicFile(await sourceFile(score(""), extension));
    expect(result.importDiagnostics).toBeUndefined();
  });
});
