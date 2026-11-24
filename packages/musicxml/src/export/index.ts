export { convertScoreToMusicXml } from "./serializeScore";
export type { MusicXmlExportOptions, MusicXmlExportResult, MxlExportResult } from "./types";
import type { Score } from "@viritura/core";
import { packMusicXml } from "../archive";
import { convertScoreToMusicXml } from "./serializeScore";
import type { MusicXmlExportOptions, MxlExportResult } from "./types";

export async function convertScoreToMxl(score: Score, options: MusicXmlExportOptions = {}): Promise<MxlExportResult> {
  const result = convertScoreToMusicXml(score, options);
  return { bytes: await packMusicXml(result.xml), diagnostics: result.diagnostics };
}
