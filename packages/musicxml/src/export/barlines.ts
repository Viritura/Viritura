import type { Score } from "@viritura/core";
import { node, type XmlContext, type XmlElement } from "./xml";

const STYLES: Readonly<Record<string, string>> = {
  regular: "regular",
  dashed: "dashed",
  dotted: "dotted",
  double: "light-light",
  final: "light-heavy",
  heavy: "heavy",
  heavyHeavy: "heavy-heavy",
  heavyLight: "heavy-light",
  noBarline: "none",
  tick: "tick",
  short: "short",
};

export function barlines(context: XmlContext, score: Score, mi: number, location: "left" | "right"): XmlElement[] {
  const measure = score.global.measures[mi]!;
  const content: XmlElement[] = [];
  if (location === "left") {
    if (measure.repeatStart) content.push(node(context, "bar-style", "heavy-light"));
    if (measure.ending)
      content.push(node(context, "ending", undefined, { number: measure.ending.numbers.join(","), type: "start" }));
    if (measure.repeatStart) content.push(node(context, "repeat", undefined, { direction: "forward" }));
  } else {
    if (measure.barline || measure.repeatEnd || mi === score.global.measures.length - 1) {
      const style = measure.repeatEnd
        ? "light-heavy"
        : measure.barline?.type
          ? STYLES[measure.barline.type]
          : "light-heavy";
      if (!style) throw new Error("Unknown barline style in MusicXML export.");
      content.push(node(context, "bar-style", style));
    }
    for (const [start, global] of score.global.measures.entries()) {
      if (global.ending && start + global.ending.duration - 1 === mi)
        content.push(
          node(context, "ending", undefined, {
            number: global.ending.numbers.join(","),
            type: global.ending.open ? "discontinue" : "stop",
          }),
        );
    }
    if (measure.repeatEnd)
      content.push(node(context, "repeat", undefined, { direction: "backward", times: measure.repeatEnd.times }));
  }
  return content.length ? [node(context, "barline", content, { location })] : [];
}
