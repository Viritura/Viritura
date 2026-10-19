import type { MnxGlobalMeasure, MnxRhythmicPosition } from "../types";
import { findChildren } from "../xmlHelpers";

/** Sound attributes carry routing; words may qualify an explicit D.C./D.S. instruction. */
export function applyNavigationSound(
  measure: MnxGlobalMeasure,
  sound: Element,
  location: MnxRhythmicPosition,
  direction?: Element,
  previousWords = "",
): void {
  const words =
    (direction
      ? findChildren(direction, "direction-type")
          .flatMap((type) => findChildren(type, "words").map((word) => word.textContent ?? ""))
          .join(" ")
      : "") || previousWords;
  const dc = sound.getAttribute("dacapo") === "yes";
  const ds = Boolean(sound.getAttribute("dalsegno"));
  const fine = sound.getAttribute("fine");
  const toCoda = sound.getAttribute("tocoda");
  if (dc || ds) {
    const alCoda = Boolean(toCoda) || /\bal\s+coda\b/i.test(words);
    const alFine = Boolean(fine) || /\bal\s+fine\b/i.test(words);
    measure.jump = {
      type: dc
        ? alCoda
          ? "dcAlCoda"
          : alFine
            ? "dcAlFine"
            : "dc"
        : alCoda
          ? "dsAlCoda"
          : alFine
            ? "dsAlFine"
            : "segno",
      location,
    };
  } else if (toCoda) {
    measure.jump = { type: "toCoda", location };
  }

  if (fine && !dc && !ds) measure.fine = { location };
  // Visible direction-type markers take precedence, retaining SMuFL/color.
  if (sound.getAttribute("segno") && !measure.segno) measure.segno = { location };
  if (sound.getAttribute("coda") && !measure.coda) measure.coda = { location };
}

export function navigationDirectionWords(
  measure: MnxGlobalMeasure,
  direction: Element,
  location: MnxRhythmicPosition,
): string {
  const words = findChildren(direction, "direction-type")
    .flatMap((type) => findChildren(type, "words").map((word) => word.textContent ?? ""))
    .join(" ")
    .trim();
  if (/^fine[.!]?$/i.test(words)) measure.fine = { location };
  const jump = measure.jump;
  if (jump && jump.location.fraction[0] * location.fraction[1] === location.fraction[0] * jump.location.fraction[1]) {
    const dc = jump.type.startsWith("dc");
    const ds = jump.type.startsWith("ds") || jump.type === "segno";
    if (dc || ds) {
      if (/\bal\s+coda\b/i.test(words)) jump.type = dc ? "dcAlCoda" : "dsAlCoda";
      else if (/\bal\s+fine\b/i.test(words)) jump.type = dc ? "dcAlFine" : "dsAlFine";
    }
  }
  return words;
}
