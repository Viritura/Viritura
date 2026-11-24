import type { DiagnosticCollector, Fermata, Note, NoteEvent } from "@viritura/core";
import { node, placement, type XmlContext, type XmlElement } from "./xml";
import { noteType, type TimedEvent, type TupletBoundary } from "./rhythm";

const ARTICULATIONS = {
  staccato: "staccato",
  staccatissimo: "staccatissimo",
  staccatissimoWedge: "staccatissimo",
  spiccato: "spiccato",
  accent: "accent",
  tenuto: "tenuto",
  strongAccent: "strong-accent",
  softAccent: "soft-accent",
  stress: "stress",
  unstress: "unstress",
} as const;
const ORNAMENTS = {
  turn: "turn",
  invertedTurn: "inverted-turn",
  mordent: "mordent",
  invertedMordent: "inverted-mordent",
  shortTrill: "other-ornament",
  trillMordent: "other-ornament",
  delayedTurn: "delayed-turn",
  schleifer: "schleifer",
} as const;

export function fermataElement(context: XmlContext, fermata: Fermata): XmlElement {
  const shape = (fermata.symbol ?? "normal").replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return node(context, "fermata", shape, {
    type: fermata.pointing === "down" || fermata.placement === "below" ? "inverted" : "upright",
  });
}

export function articulationElements(context: XmlContext, event: NoteEvent, note?: Note): XmlElement[] {
  const marks = event.markings;
  const elements: XmlElement[] = [];
  for (const [key, tag] of Object.entries(ARTICULATIONS)) {
    const value = marks?.[key as keyof typeof ARTICULATIONS];
    if (value)
      elements.push(
        node(context, tag, undefined, {
          placement: placement(value.placement),
          ...(key === "strongAccent" ? { type: marks?.strongAccent?.pointing === "down" ? "down" : "up" } : {}),
        }),
      );
  }
  if (marks?.breath)
    elements.push(
      node(context, "breath-mark", marks.breath.symbol === "auto" ? "comma" : (marks.breath.symbol ?? "comma"), {
        placement: placement(marks.breath.placement),
      }),
    );
  if (marks?.caesura) elements.push(node(context, "caesura", marks.caesura.style ?? "normal"));
  if (note?.markings?.slideIn) elements.push(node(context, note.markings.slideIn.type === "plop" ? "plop" : "scoop"));
  if (note?.markings?.slideOut)
    elements.push(node(context, note.markings.slideOut.type === "doit" ? "doit" : "falloff"));
  return elements.length ? [node(context, "articulations", elements)] : [];
}

export function ornamentElements(
  context: XmlContext,
  timed: TimedEvent,
  diagnostics: DiagnosticCollector,
  pointer: string,
): XmlElement[] {
  const marks = timed.event.markings;
  const elements: XmlElement[] = [];
  if (marks?.trill) {
    if (marks.trill.showSymbol !== false) elements.push(node(context, "trill-mark"));
    if (marks.trill.accidental !== undefined) {
      const accidentals: Readonly<Record<number, string>> = {
        [-3]: "triple-flat",
        [-2]: "flat-flat",
        [-1]: "flat",
        0: "natural",
        1: "sharp",
        2: "double-sharp",
        3: "triple-sharp",
      };
      const text = accidentals[marks.trill.accidental];
      if (text === undefined) throw new Error("The trill accidental has no standard MusicXML spelling.");
      elements.push(node(context, "accidental-mark", text));
    }
  }
  for (const ornament of marks?.ornaments ?? []) {
    const glyph =
      ornament === "shortTrill"
        ? "ornamentShortTrill"
        : ornament === "trillMordent"
          ? "ornamentTrillMordent"
          : undefined;
    elements.push(node(context, ORNAMENTS[ornament], undefined, { smufl: glyph }));
    if (ornament === "shortTrill" || ornament === "trillMordent")
      diagnostics.warn(
        pointer,
        `The ${ornament} ornament retains its SMuFL glyph; its display depends on the receiving application.`,
        "musicxml-ornament",
      );
  }
  const tremolo = timed.tremolo ?? (marks?.tremolo ? { type: "single", marks: marks.tremolo.marks } : undefined);
  if (tremolo) {
    if (!Number.isInteger(tremolo.marks) || tremolo.marks < 0 || tremolo.marks > 8)
      throw new Error("MusicXML tremolos require 0–8 marks.");
    elements.push(node(context, "tremolo", tremolo.marks, { type: tremolo.type }));
  }
  return elements;
}

export function technicalElements(context: XmlContext, event: NoteEvent): XmlElement[] {
  const elements = (event.markings?.fingerings ?? []).map((fingering) => node(context, "fingering", fingering.finger));
  if (event.markings?.bowDirection) {
    elements.push(
      node(context, event.markings.bowDirection.direction === "up" ? "up-bow" : "down-bow", undefined, {
        placement: placement(event.markings.bowDirection.placement),
      }),
    );
  }
  return elements.length ? [node(context, "technical", elements)] : [];
}

export function tupletElement(context: XmlContext, boundary: TupletBoundary): XmlElement {
  const { tuplet, type, number } = boundary;
  const portion = (name: string, quantity: typeof tuplet.inner) =>
    node(context, name, [
      node(context, "tuplet-number", quantity.multiple),
      noteType(quantity.duration) ? node(context, "tuplet-type", noteType(quantity.duration)) : undefined,
      ...Array.from({ length: quantity.duration.dots ?? 0 }, () => node(context, "tuplet-dot")),
    ]);
  return node(
    context,
    "tuplet",
    type === "start" ? [portion("tuplet-actual", tuplet.inner), portion("tuplet-normal", tuplet.outer)] : [],
    {
      type,
      number,
      placement: placement(tuplet.placement),
      bracket: tuplet.bracket === "auto" ? undefined : tuplet.bracket,
      "show-number": tuplet.showNumber === "noNumber" ? "none" : tuplet.showNumber === "both" ? "both" : "actual",
      "show-type": tuplet.showValue === "inner" ? "actual" : tuplet.showValue === "both" ? "both" : "none",
    },
  );
}
