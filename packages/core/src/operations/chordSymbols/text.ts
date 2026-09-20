import type { ChordQuality, ChordRoot, ChordSymbol, RhythmicPosition } from "../../model";

function parseRoot(step: string, accidental: string): ChordRoot {
  const normalized = accidental.replaceAll("♭", "b").replaceAll("♯", "#");
  const alter =
    normalized === "x" || normalized === "𝄪"
      ? 2
      : normalized === "𝄫"
        ? -2
        : [...normalized].reduce((sum, token) => sum + (token === "#" ? 1 : -1), 0);
  return alter === 0 ? { step: step.toUpperCase() } : { step: step.toUpperCase(), alter };
}

/** Captures whitespace, root, suffix, and optional slash root without rewriting authored syntax. */
export const CHORD_TEXT_PATTERN =
  /^(\s*)([A-Ga-g])((?:#+|b+|♯+|♭+|x|𝄪|𝄫)?)([^/]*?)(?:\/([A-Ga-g])((?:#+|b+|♯+|♭+|x|𝄪|𝄫)?))?(\s*)$/u;

export function isNoChordText(text: string): boolean {
  return /^(?:NC|N\.C\.?)$/i.test(text.trim());
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

interface ParsedQuality {
  quality: ChordQuality;
  extension?: ChordSymbol["extension"];
}

function parseSpecialQuality(text: string): ParsedQuality | undefined {
  if (text === "") return { quality: "major" };
  if (text === "Δ" || text === "△") return { quality: "major", extension: 7 };
  if (text === "5") return { quality: "power" };
  if (text.toLowerCase() === "sus" || text.toLowerCase() === "sus4") return { quality: "suspended4" };
  if (text.toLowerCase() === "sus2") return { quality: "suspended2" };
  if (text.toLowerCase() === "m7b5") return { quality: "half-diminished", extension: 7 };
  const halfDiminished = /^(?:0|ø)(6|7|9|11|13)?$/.exec(text);
  if (halfDiminished) return { quality: "half-diminished", extension: parseExtension(halfDiminished[1]) ?? 7 };
  const minorMajor = /^(?:m|min|-)(?:maj|ma|M|Δ|△)(6|7|9|11|13)?$/i.exec(text);
  if (minorMajor) return { quality: "minor-major", extension: parseExtension(minorMajor[1]) ?? 7 };
  const suspended = /^(6|7|9|11|13)sus([24])?$/i.exec(text);
  if (suspended)
    return {
      quality: suspended[2] === "2" ? "suspended2" : "suspended4",
      extension: parseExtension(suspended[1]),
    };
  return undefined;
}

export function parseQuality(text: string): ParsedQuality | undefined {
  const special = parseSpecialQuality(text);
  if (special) return special;
  const match = /^(maj|Maj|MAJ|ma|Ma|M|m|min|Min|MIN|-|dim|Dim|DIM|o|°|aug|Aug|AUG|\+|Δ|△)?(6|7|9|11|13)?$/.exec(text);
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
    case "°":
      quality = "diminished";
      break;
    case "aug":
    case "+":
      quality = "augmented";
      break;
    case "maj":
    case "ma":
    case "Δ":
    case "δ":
    case "△":
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
 * The returned event is anchored by its containing measure and relative time.
 * Every input, including malformed/empty text and NC, is preserved verbatim.
 * Unsupported suffixes are never interpreted as major. Use resolveChordSymbol
 * before playback or semantic validation.
 */
export function parseChordSymbolText(input: string, position: RhythmicPosition): ChordSymbol {
  const match = CHORD_TEXT_PATTERN.exec(input);
  if (!match) return { position, rawText: input };

  const root = parseRoot(match[2]!, match[3] ?? "");
  const parsedQuality = parseQuality(match[4] ?? "");

  const chord: ChordSymbol = {
    position,
    rawText: input,
    root,
    quality: parsedQuality?.quality ?? "other",
  };
  if (!parsedQuality) chord.kindText = match[4]!;
  if (parsedQuality?.extension !== undefined) chord.extension = parsedQuality.extension;

  if (match[5]) {
    chord.bass = parseRoot(match[5], match[6] ?? "");
  }

  return chord;
}

export function formatChordRoot(root: ChordRoot): string {
  const alter = root.alter ?? 0;
  if (!Number.isSafeInteger(alter) || Math.abs(alter) > 128) return `${root.step}(${alter})`;
  return root.step + (alter > 0 ? "#".repeat(alter) : "b".repeat(-alter));
}

function formatQuality(chord: ChordSymbol): string {
  const extension = chord.extension;
  switch (chord.quality ?? "major") {
    case "major":
      return extension === undefined ? "" : extension === 6 ? "6" : `maj${extension}`;
    case "minor":
      return `m${extension ?? ""}`;
    case "dominant":
      return String(extension ?? 7);
    case "diminished":
      return `dim${extension ?? ""}`;
    case "half-diminished":
      return `ø${extension ?? 7}`;
    case "augmented":
      return `aug${extension ?? ""}`;
    case "minor-major":
      return `mMaj${extension ?? 7}`;
    case "suspended2":
      return `${extension ?? ""}sus2`;
    case "suspended4":
      return `${extension ?? ""}sus4`;
    case "power":
      return extension === undefined ? "5" : `5(${extension})`;
    case "other":
      return chord.kindText ?? "?";
  }
}

/** Display text, not a promise of playability. Overrides/raw syntax are never discarded. */
export function formatChordSymbolText(chord: ChordSymbol): string {
  if (chord.textOverride !== undefined) return chord.textOverride;
  if (chord.rawText !== undefined) return chord.rawText;
  if (!chord.root) return "";
  return formatChordRoot(chord.root) + formatQuality(chord) + (chord.bass ? `/${formatChordRoot(chord.bass)}` : "");
}
