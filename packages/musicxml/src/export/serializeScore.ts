import { DiagnosticCollector, type Score } from "@viritura/core";
import type { ExportSequence, MusicXmlExportOptions, MusicXmlExportResult, PartPlan } from "./types";
import { selectExport } from "./selection";
import { preparePart } from "./measurePlan";
import { measureAttributes, type AttributeItem } from "./attributes";
import { buildDirections, directionElement } from "./directions";
import { buildSpanners } from "./spanners";
import { eventNotes } from "./notes";
import { partListEntry } from "./instruments";
import { scoreHeader } from "./metadata";
import { barlines } from "./barlines";
import { add, compare, divisionsFor, rebasePosition, subtract, ticks, ZERO, type Rational } from "./rhythm";
import { createXml, node, serializeXml, type XmlContext, type XmlElement } from "./xml";

function partAttributes(context: XmlContext, score: Score, plan: PartPlan, useWritten: boolean): AttributeItem[][] {
  const rows: AttributeItem[][] = plan.measures.map(() => []);
  const durations = plan.measures.map((measure) => measure.duration);
  plan.measures.forEach((_, mi) => {
    for (const item of measureAttributes(context, score, plan, mi, 1n, useWritten)) {
      const target = rebasePosition(mi, item.position, durations);
      rows[target.mi]!.push({ ...item, position: target.position });
    }
  });
  return rows.map((items) => items.sort((a, b) => compare(a.position, b.position)));
}

function renderPart(
  context: XmlContext,
  score: Score,
  plan: PartPlan,
  useWritten: boolean,
  global: boolean,
  diagnostics: DiagnosticCollector,
): XmlElement {
  const spans = buildSpanners(plan, diagnostics);
  const directions = buildDirections(context, score, plan, global, useWritten, diagnostics);
  const attributeRows = partAttributes(context, score, plan, useWritten);
  const measures = plan.measures.map((measure, mi) => {
    const attributes = attributeRows[mi]!;
    const values = [
      measure.duration,
      ...attributes.map((item) => item.position),
      ...directions[mi]!.map((item) => item.position),
      ...measure.sequences.flatMap((sequence) => sequence.events.flatMap((event) => [event.position, event.duration])),
    ];
    const divisions = divisionsFor(values);
    const declaration = attributes.flatMap((item) => Array.from(item.element.getElementsByTagName("divisions")))[0];
    if (!declaration) throw new Error("MusicXML measure has no divisions declaration.");
    declaration.textContent = String(divisions);
    const content: XmlElement[] = [];
    let cursor = ZERO;
    const moveTo = (position: Rational, sequence?: ExportSequence) => {
      const difference = subtract(position, cursor);
      if (difference.n !== 0n)
        content.push(
          node(context, difference.n > 0n ? "forward" : "backup", [
            node(context, "duration", ticks(difference.n < 0n ? subtract(ZERO, difference) : difference, divisions)),
            difference.n > 0n && sequence ? node(context, "voice", sequence.voice) : undefined,
            difference.n > 0n && sequence && plan.selection.staves.size > 1
              ? node(context, "staff", sequence.staff)
              : undefined,
          ]),
        );
      cursor = position;
    };
    for (const item of attributes) {
      if (compare(item.position, ZERO) < 0 || compare(item.position, measure.duration) > 0)
        throw new Error("Attribute change lies outside its measure.");
      moveTo(item.position);
      content.push(item.element);
    }
    moveTo(ZERO);
    for (const item of directions[mi]!) {
      if (compare(item.position, ZERO) < 0 || compare(item.position, measure.duration) > 0)
        throw new Error(
          `Direction in "${plan.selection.part.name}", measure ${mi + 1}, at ${item.position.n}/${item.position.d} lies outside its ${measure.duration.n}/${measure.duration.d} duration.`,
        );
      content.push(directionElement(context, item, divisions));
    }
    content.push(...barlines(context, score, mi, "left"));
    for (const sequence of measure.sequences) {
      moveTo(ZERO);
      for (const event of sequence.events) {
        moveTo(event.position, sequence);
        content.push(
          ...eventNotes(
            {
              xml: context,
              score,
              plan,
              measureIndex: mi,
              sequence,
              spanners: spans,
              divisions,
              diagnostics,
              useWritten,
            },
            event,
          ),
        );
        cursor = add(cursor, event.duration);
      }
      moveTo(measure.duration, sequence);
    }
    content.push(...barlines(context, score, mi, "right"));
    return node(context, "measure", content, {
      number: String(measure.global.number ?? (score.global.measures[0]?.number === 0 ? mi : mi + 1)),
      implicit: mi === 0 && measure.global.number === 0 ? "yes" : undefined,
      "non-controlling": measure.time.display === "senzaMisura" ? "yes" : undefined,
    });
  });
  return node(context, "part", measures, { id: plan.selection.xmlId });
}

export function convertScoreToMusicXml(score: Score, options: MusicXmlExportOptions = {}): MusicXmlExportResult {
  if (score.global.measures.length === 0) throw new Error("The document has no measures to export.");
  const diagnostics = options.diagnostics ?? new DiagnosticCollector();
  const selection = selectExport(score, options, diagnostics);
  const context = createXml();
  const plans = selection.parts.map((part) => preparePart(score, part, diagnostics));
  const root = node(
    context,
    "score-partwise",
    [
      ...scoreHeader(context, score, selection, diagnostics),
      node(
        context,
        "part-list",
        selection.parts.map((part) => partListEntry(context, score, part)),
      ),
      ...plans.map((plan, i) => renderPart(context, score, plan, selection.useWritten, i === 0, diagnostics)),
    ],
    { version: "4.0" },
  );
  return { xml: serializeXml(context, root), diagnostics: diagnostics.all() };
}
