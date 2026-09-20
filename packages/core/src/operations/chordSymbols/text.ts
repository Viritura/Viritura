import type { ChordQuality, ChordRoot, ChordSymbol, RhythmicPosition } from "../../model";
import { resolveChordSymbol } from "./resolution";
import { formatModifiers, parseModifiers, type ChordModifiers } from "./modifiers";

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
  modifiers?: ChordModifiers;
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
  const reverseSuspended = /^sus([24])?(6|7|9|11|13)$/i.exec(text);
  if (reverseSuspended)
    return {
      quality: reverseSuspended[1] === "2" ? "suspended2" : "suspended4",
      extension: parseExtension(reverseSuspended[2]),
    };
  return undefined;
}

function parseBaseQuality(text: string): ParsedQuality | undefined {
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

export function parseQuality(text: string): ParsedQuality | undefined {
  const boundary = text.search(/add|omit|no|\(/i);
  if (boundary < 0) return parseBaseQuality(text);
  const base = parseBaseQuality(text.slice(0, boundary).trim());
  const modifiers = parseModifiers(text.slice(boundary));
  if (!base || !modifiers) return undefined;
  if (
    base.quality === "major" &&
    base.extension === undefined &&
    modifiers.added.length === 1 &&
    modifiers.added[0] === 6 &&
    modifiers.omitted.length === 0
  ) {
    return { quality: "major", extension: 6 };
  }
  return { ...base, modifiers };
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
  if (!parsedQuality || parsedQuality.modifiers) chord.kindText = match[4]!;
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

function formatRewriteModifiers(kind: ParsedQuality | undefined, raw: ChordSymbol | undefined): string {
  const rawModifiers = raw?.kindText === undefined ? undefined : parseQuality(raw.kindText)?.modifiers;
  return formatModifiers({
    added: [...new Set([...(kind?.modifiers?.added ?? []), ...(rawModifiers?.added ?? [])])].sort((a, b) => a - b),
    omitted: [...new Set([...(kind?.modifiers?.omitted ?? []), ...(rawModifiers?.omitted ?? [])])].sort(
      (a, b) => a - b,
    ),
  });
}

/**
 * Rewrite only the base harmony, retaining explicit degree operations and display overrides.
 * Unknown or contradictory source harmony is left untouched rather than guessed.
 */
export function rewriteChordSymbolBase(
  chord: ChordSymbol,
  base: Partial<Pick<ChordSymbol, "quality" | "extension">>,
): ChordSymbol {
  const raw = chord.rawText === undefined ? undefined : parseChordSymbolText(chord.rawText, chord.position);
  const source = chord.root ? chord : { ...chord, ...raw };
  const kind = source.kindText === undefined ? undefined : parseQuality(source.kindText);
  // Other can carry a recognized suffix after an explicit quality edit; keep that edit reversible.
  const understood =
    source.quality === "other" && kind ? { ...source, quality: kind.quality, extension: kind.extension } : source;
  if (resolveChordSymbol({ ...understood, textOverride: undefined }).status !== "supported") return chord;
  const next = { ...source, extension: understood.extension, ...base };
  if (next.quality === source.quality && next.extension === source.extension) return chord;
  const modifiers = formatRewriteModifiers(kind, raw);
  const currentKind = formatQuality(understood) + modifiers;
  if (resolveChordSymbol({ ...understood, kindText: currentKind, textOverride: undefined }).status !== "supported")
    return chord;
  const nextBase = next.quality === "other" ? { ...next, quality: understood.quality } : next;
  next.kindText = modifiers || next.quality === "other" ? formatQuality(nextBase) + modifiers : undefined;
  next.rawText = undefined;
  next.rawText = formatChordSymbolText({ ...next, textOverride: undefined });
  if (resolveChordSymbol({ ...next, quality: nextBase.quality, textOverride: undefined }).status !== "supported")
    return chord;
  return next;
}

/** Semantic plain-text label; provenance remains stored separately from explicit display overrides. */
export function formatChordSymbolText(chord: ChordSymbol): string {
  if (chord.textOverride !== undefined) return chord.textOverride;
  if (chord.rawText !== undefined) {
    if (resolveChordSymbol(chord).status !== "supported") return chord.rawText;
    if (!chord.root) chord = parseChordSymbolText(chord.rawText, chord.position);
  }
  if (!chord.root) return "";
  const suffix =
    chord.kindText !== undefined && resolveChordSymbol(chord).status === "unsupported"
      ? chord.kindText
      : formatQuality(chord) +
        (chord.kindText ? formatModifiers(parseQuality(chord.kindText)?.modifiers ?? { added: [], omitted: [] }) : "");
  return formatChordRoot(chord.root) + suffix + (chord.bass ? `/${formatChordRoot(chord.bass)}` : "");
}
