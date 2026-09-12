import type { ChordQuality, ChordRoot, ChordSymbol, RhythmicPosition } from "../model";

function parseRoot(step: string, accidental: string): ChordRoot | undefined {
  const alter =
    accidental === ""
      ? undefined
      : accidental === "#"
        ? 1
        : accidental === "##" || accidental === "x"
          ? 2
          : accidental === "b"
            ? -1
            : accidental === "bb"
              ? -2
              : undefined;
  if (accidental !== "" && alter === undefined) return undefined;
  return alter === undefined ? { step: step.toUpperCase() } : { step: step.toUpperCase(), alter };
}

function parseExtension(value: string | undefined): ChordSymbol["extension"] {
  switch (value) {
    case "6":
      return 6;
    case "7":
      return 7;
    case "9":
      return 9;
    case "11":
      return 11;
    case "13":
      return 13;
    default:
      return undefined;
  }
}

function parseQuality(text: string): { quality: ChordQuality; extension?: ChordSymbol["extension"] } | undefined {
  if (text === "") return { quality: "major" };
  if (text === "5") return { quality: "power" };
  if (text.toLowerCase() === "sus" || text.toLowerCase() === "sus4") return { quality: "suspended4" };
  if (text.toLowerCase() === "sus2") return { quality: "suspended2" };
  if (text === "0" || text.toLowerCase() === "m7b5") return { quality: "half-diminished", extension: 7 };
  if (/^m(?:maj|ma)7$/i.test(text)) return { quality: "minor-major", extension: 7 };

  const match = /^(maj|Maj|MAJ|ma|Ma|M|m|min|Min|MIN|-|dim|Dim|DIM|o|aug|Aug|AUG|\+)?(6|7|9|11|13)?$/.exec(text);
  if (!match) return undefined;

  const marker = match[1] ?? "";
  const normalizedMarker = marker.toLowerCase();
  const extension = parseExtension(match[2]);

  let quality: ChordQuality;
  switch (normalizedMarker) {
    case "m":
      quality = marker === "M" ? "major" : "minor";
      break;
    case "min":
    case "-":
      quality = "minor";
      break;
    case "dim":
    case "o":
      quality = "diminished";
      break;
    case "aug":
    case "+":
      quality = "augmented";
      break;
    case "maj":
    case "ma":
      quality = "major";
      break;
    default:
      quality = extension === undefined || extension === 6 ? "major" : "dominant";
  }

  return extension === undefined ? { quality } : { quality, extension };
}

/**
 * Parse the common chord-symbol shorthand used by inline entry.
 *
 * The returned event is anchored only by measure-relative time and optional
 * staff. Selecting a note is an editor convenience, not persistent ownership.
 */
export function parseChordSymbolText(
  input: string,
  position: RhythmicPosition,
  staff?: number,
): ChordSymbol | undefined {
  const text = input.trim();
  const match = /^([A-Ga-g])(bb|##|b|#|x)?([^/]*?)(?:\/([A-Ga-g])(bb|##|b|#|x)?)?$/.exec(text);
  if (!match) return undefined;

  const root = parseRoot(match[1]!, match[2] ?? "");
  const parsedQuality = parseQuality(match[3] ?? "");
  if (!root) return undefined;

  const chord: ChordSymbol = {
    position,
    root,
    quality: parsedQuality?.quality ?? "other",
  };
  if (!parsedQuality) chord.kindText = match[3]!;
  if (staff !== undefined) chord.staff = staff;
  if (parsedQuality?.extension !== undefined) chord.extension = parsedQuality.extension;

  if (match[4]) {
    const bass = parseRoot(match[4], match[5] ?? "");
    if (!bass) return undefined;
    chord.bass = bass;
  }

  return chord;
}
