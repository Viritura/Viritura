import type { DiagnosticCollector, Fretboard, FretboardNote } from "@viritura/core";
import { childText, findChild, findChildren } from "../xmlHelpers";

export function collectFretboardDiagnostics(root: Element, dx: DiagnosticCollector): void {
  const frames = root.getElementsByTagName("frame");
  const unsupported = new Set<string>();
  const supported: Readonly<Record<string, readonly string[]>> = {
    frame: ["unplayed"],
    "first-fret": ["text", "location"],
    barre: ["type"],
  };
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]!;
    for (const element of [frame, ...Array.from(frame.getElementsByTagName("*"))]) {
      for (const attribute of Array.from(element.attributes)) {
        if (!(supported[element.tagName] ?? []).includes(attribute.name))
          unsupported.add(`${element.tagName}@${attribute.name}`);
      }
    }
  }
  if (unsupported.size)
    dx.warn(
      "/frame",
      `Chord diagram appearance attributes are not preserved: ${[...unsupported].join(", ")}. Viritura uses its own engraving defaults.`,
      "musicxml-frame-appearance",
    );
}

function integer(element: Element, name: string): number {
  const text = childText(element, name);
  const value = Number(text);
  if (text === null || !text.trim() || !Number.isSafeInteger(value)) throw new Error(`Invalid MusicXML frame ${name}.`);
  return value;
}

export function extractFretboard(harmony: Element): Omit<Fretboard, "partId"> | undefined {
  const element = findChild(harmony, "frame");
  if (!element) return undefined;
  const first = findChild(element, "first-fret");
  const frame: Omit<Fretboard, "partId"> = {
    frameStrings: integer(element, "frame-strings"),
    frameFrets: integer(element, "frame-frets"),
    frameNotes: findChildren(element, "frame-note").map((entry): FretboardNote => {
      const note: FretboardNote = { string: integer(entry, "string"), fret: integer(entry, "fret") };
      const fingering = childText(entry, "fingering");
      if (fingering !== null) note.fingering = fingering;
      const barre = findChild(entry, "barre");
      if (barre) {
        const type = barre.getAttribute("type");
        if (type !== "start" && type !== "stop") throw new Error("Invalid MusicXML frame barre type.");
        note.barre = type;
      }
      return note;
    }),
  };
  if (first) {
    const location = first.getAttribute("location");
    if (location !== null && location !== "left" && location !== "right")
      throw new Error("Invalid MusicXML first-fret location.");
    frame.firstFret = {
      fret: integer(element, "first-fret"),
      ...(first.hasAttribute("text") ? { text: first.getAttribute("text")! } : {}),
      ...(location ? { location } : {}),
    };
  }
  if (element.hasAttribute("unplayed")) frame.unplayed = element.getAttribute("unplayed")!;
  return frame;
}
