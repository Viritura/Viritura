import type { DiagnosticCollector, Swing } from "@viritura/core";
import { childElements, childText, findChild, findChildren } from "../xmlHelpers";

export function readSoundSwing(sound: Element): Swing | undefined {
  const elements = findChildren(sound, "swing");
  if (elements.length === 0) return undefined;
  if (elements.length !== 1) throw new Error("MusicXML sound must not contain multiple swing instructions.");
  const element = elements[0]!;
  const children = childElements(element);
  const straight = findChild(element, "straight");
  const unsupported = children.find(
    (child) => !["straight", "first", "second", "swing-type", "swing-style"].includes(child.tagName),
  );
  if (unsupported) throw new Error(`Unsupported MusicXML swing child: ${unsupported.tagName}`);
  if (straight) {
    if (findChildren(element, "straight").length !== 1) throw new Error("MusicXML straight must occur once.");
    if (children.some((child) => ["first", "second", "swing-type"].includes(child.tagName))) {
      throw new Error("MusicXML swing cannot contain both straight and a ratio.");
    }
    return { mode: "straight" };
  }
  const integer = (name: string): number => {
    const text = childText(element, name)?.trim();
    if (findChildren(element, name).length !== 1 || !text || !/^\+?\d+$/.test(text)) {
      throw new Error(`MusicXML swing ${name} must be one positive integer.`);
    }
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`MusicXML swing ${name} must be a positive safe integer.`);
    return value;
  };
  const ratio: [number, number] = [integer("first"), integer("second")];
  if (findChildren(element, "swing-type").length > 1) throw new Error("MusicXML swing-type must occur at most once.");
  const subdivision = childText(element, "swing-type")?.trim() ?? "eighth";
  if (subdivision !== "eighth" && subdivision !== "16th")
    throw new Error(`Unsupported MusicXML swing-type: ${subdivision}`);
  return { mode: "swing", subdivision, ratio };
}

export function diagnoseUnsupportedSwingScope(root: Element, diagnostics?: DiagnosticCollector): void {
  const parts = findChildren(root, "part");
  for (const [partIndex, part] of parts.entries()) {
    for (const [measureIndex, measure] of findChildren(part, "measure").entries()) {
      for (const child of childElements(measure)) {
        const sound = child.tagName === "sound" ? child : findChild(child, "sound");
        if (!sound || !findChild(sound, "swing")) continue;
        readSoundSwing(sound);
        if (partIndex === 0 && (child.tagName !== "direction" || !findChild(child, "staff"))) continue;
        const message =
          "Staff/secondary-part swing cannot be represented by the global tempo importer; configure a score-wide tempo swing instruction explicitly. It was not promoted to global scope.";
        if (!diagnostics) throw new Error(message);
        diagnostics.warn(`/parts/${partIndex}/measures/${measureIndex}/sound/swing`, message, "musicxml-swing-scope");
      }
    }
  }
}
