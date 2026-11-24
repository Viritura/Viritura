import { resolveScorePageSetup, type DiagnosticCollector, type Score } from "@viritura/core";
import type { ExportSelection } from "./types";
import { textElements } from "./text";
import { node, type XmlContext, type XmlElement } from "./xml";

function frameCredits(context: XmlContext, selection: ExportSelection, diagnostics: DiagnosticCollector): XmlElement[] {
  return (selection.definition?.textFrames ?? []).map((frame) => {
    const page = frame.locator.type === "page" ? frame.locator.pageIndex + 1 : 1;
    diagnostics.warn(
      "",
      "Page text is retained as MusicXML credits; musical anchors, wrapping, and page-edge positioning are reflowed.",
      "musicxml-page-text",
    );
    return node(context, "credit", textElements(context, frame.content, diagnostics, "credit-words"), { page });
  });
}
export function scoreHeader(
  context: XmlContext,
  score: Score,
  selection: ExportSelection,
  diagnostics: DiagnosticCollector,
): XmlElement[] {
  const metadata = score.metadata;
  const result: XmlElement[] = [];
  if (metadata?.title) result.push(node(context, "work", [node(context, "work-title", metadata.title)]));
  if (metadata?.subtitle) result.push(node(context, "movement-title", metadata.subtitle));
  const identification: XmlElement[] = [];
  for (const role of ["composer", "lyricist", "arranger"] as const)
    if (metadata?.[role]) identification.push(node(context, "creator", metadata[role], { type: role }));
  if (metadata?.copyright) identification.push(node(context, "rights", metadata.copyright));
  identification.push(node(context, "encoding", [node(context, "software", "Viritura")]));
  result.push(node(context, "identification", identification));
  const setup = selection.definition
    ? resolveScorePageSetup(score, score.scores!.indexOf(selection.definition))
    : undefined;
  const defaults: XmlElement[] = [];
  if (setup) {
    if ([setup.width, setup.height, setup.spatiumMm].some((value) => !Number.isFinite(value) || value <= 0))
      throw new Error("Invalid export page dimensions.");
    defaults.push(
      node(context, "scaling", [node(context, "millimeters", setup.spatiumMm * 4), node(context, "tenths", 40)]),
    );
  }
  if (!selection.useWritten) defaults.push(node(context, "concert-score"));
  if (setup) {
    const tenths = (mm: number) => (mm * 10) / setup.spatiumMm;
    defaults.push(
      node(context, "page-layout", [
        node(context, "page-height", tenths(setup.height)),
        node(context, "page-width", tenths(setup.width)),
        node(
          context,
          "page-margins",
          [
            node(context, "left-margin", tenths(setup.margins.left)),
            node(context, "right-margin", tenths(setup.margins.right)),
            node(context, "top-margin", tenths(setup.margins.top)),
            node(context, "bottom-margin", tenths(setup.margins.bottom)),
          ],
          { type: "both" },
        ),
      ]),
    );
  }
  if (defaults.length) result.push(node(context, "defaults", defaults));
  result.push(...frameCredits(context, selection, diagnostics));
  if (selection.definition?.layout || score.textStyles || score.timeSignatures || score.chordSymbolStyle)
    diagnostics.info(
      "",
      "The receiving application reflows typography, system geometry, condensing, and engraving settings.",
      "musicxml-engraving-reflow",
    );
  if (score.soundProfile || score.mixer || score.videoSync || score.lyricWorkflow)
    diagnostics.info(
      "",
      "Viritura sound profiles, mixing, video synchronization, and lyric editing data remain in the original score.",
      "musicxml-editor-data",
    );
  return result;
}
