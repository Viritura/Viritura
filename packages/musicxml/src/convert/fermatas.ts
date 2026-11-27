import { collectScoreEventSpans, type DiagnosticCollector } from "@viritura/core";
import { parseMnxWithDiagnostics } from "@viritura/format";
import type { MnxDocument, MnxEvent, MnxSequenceContent } from "../types";

function eventAt(content: MnxSequenceContent[], path: readonly number[]): MnxEvent {
  const [index, ...children] = path;
  const item = index === undefined ? undefined : content.at(index);
  if (!item) throw new Error("Imported fermata has no rhythmic carrier.");
  if (children.length) {
    if (item.type !== "tuplet" && item.type !== "tremolo") throw new Error("Fermata path is not a rhythmic container.");
    return eventAt(item.content, children);
  }
  if (item.type !== undefined) throw new Error("Fermata path does not resolve to a main event.");
  return item;
}

/** Normalize only fermatas, leaving all other converter output untouched. */
export function consolidateImportedFermatas(
  document: MnxDocument,
  diagnostics?: DiagnosticCollector,
  root?: Element,
): void {
  const field = root
    ? Array.from(root.getElementsByTagName("miscellaneous-field")).find(
        (element) => element.getAttribute("name") === "viritura-global-fermatas",
      )
    : undefined;
  if (field?.textContent) {
    const rows: unknown = JSON.parse(field.textContent);
    if (!Array.isArray(rows) || rows.length !== document.global.measures.length)
      throw new Error("Invalid MusicXML global fermata metadata.");
    rows.forEach((fermatas: unknown, measureIndex) => {
      if (!Array.isArray(fermatas)) throw new Error("Invalid MusicXML global fermata metadata.");
      const measure = document.global.measures[measureIndex]!;
      measure._x = { ...measure._x, viritura: { ...measure._x?.viritura, fermatas } };
    });
  }
  const parsed = parseMnxWithDiagnostics(document);
  const rows = collectScoreEventSpans(parsed.score);
  parsed.score.global.measures.forEach((measure, measureIndex) => {
    if (measure.fermatas?.length) {
      const raw = document.global.measures[measureIndex]!;
      raw._x = { ...raw._x, viritura: { ...raw._x?.viritura, fermatas: measure.fermatas } };
    }
    for (const span of rows[measureIndex]!) {
      const sequence = document.parts[span.partIndex]?.measures[measureIndex]?.sequences?.[span.sequenceIndex];
      if (!sequence) continue;
      if (span.event) {
        const event = eventAt(sequence.content, span.contentPath);
        if (span.event.fermata) event.fermata = span.event.fermata;
        else delete event.fermata;
      } else if (sequence.fullMeasure) {
        if (span.sequence.fullMeasure?.fermata) sequence.fullMeasure.fermata = span.sequence.fullMeasure.fermata;
        else delete sequence.fullMeasure.fermata;
      }
    }
  });
  for (const notice of parsed.diagnostics) {
    if (notice.code === "unmerged-local-fermata") diagnostics?.emit(notice);
  }
}
