import type { ChordQuality, ChordRoot, ChordSymbol, RhythmicPosition } from "@viritura/core";
import { childText, findChild } from "../xmlHelpers";

interface ChordKindMapping {
  quality: ChordQuality;
  extension?: ChordSymbol["extension"];
}

const CHORD_KIND_MAP: Record<string, ChordKindMapping> = {
  major: { quality: "major" },
  minor: { quality: "minor" },
  augmented: { quality: "augmented" },
  diminished: { quality: "diminished" },
  dominant: { quality: "dominant", extension: 7 },
  "major-seventh": { quality: "major", extension: 7 },
  "minor-seventh": { quality: "minor", extension: 7 },
  "diminished-seventh": { quality: "diminished", extension: 7 },
  "augmented-seventh": { quality: "augmented", extension: 7 },
  "half-diminished": { quality: "half-diminished", extension: 7 },
  "major-minor": { quality: "minor-major", extension: 7 },
  "major-sixth": { quality: "major", extension: 6 },
  "minor-sixth": { quality: "minor", extension: 6 },
  "dominant-ninth": { quality: "dominant", extension: 9 },
  "major-ninth": { quality: "major", extension: 9 },
  "minor-ninth": { quality: "minor", extension: 9 },
  "dominant-11th": { quality: "dominant", extension: 11 },
  "major-11th": { quality: "major", extension: 11 },
  "minor-11th": { quality: "minor", extension: 11 },
  "dominant-13th": { quality: "dominant", extension: 13 },
  "major-13th": { quality: "major", extension: 13 },
  "minor-13th": { quality: "minor", extension: 13 },
  power: { quality: "power" },
  "suspended-second": { quality: "suspended2" },
  "suspended-fourth": { quality: "suspended4" },
};

function readRoot(parent: Element, prefix: "root" | "bass"): ChordRoot | undefined {
  const step = childText(parent, `${prefix}-step`)?.trim().toUpperCase();
  if (!step || !/^[A-G]$/.test(step)) return undefined;
  const root: ChordRoot = { step };
  const alterText = childText(parent, `${prefix}-alter`);
  if (alterText !== null) {
    const alter = Number.parseInt(alterText, 10);
    if (Number.isInteger(alter)) root.alter = alter;
  }
  return root;
}

function readStaff(harmony: Element): number | undefined {
  const staffText = childText(harmony, "staff");
  if (staffText === null) return undefined;
  const staff = Number.parseInt(staffText, 10);
  return Number.isInteger(staff) && staff >= 1 ? staff : undefined;
}

export function extractChordSymbol(harmony: Element, position: RhythmicPosition): ChordSymbol | undefined {
  const rootElement = findChild(harmony, "root");
  const kindElement = findChild(harmony, "kind");
  if (!rootElement || !kindElement) return undefined;

  const root = readRoot(rootElement, "root");
  const sourceKind = kindElement.textContent?.trim() ?? "";
  const kind = CHORD_KIND_MAP[sourceKind];
  if (!root) return undefined;

  const authoredKindText = kindElement.getAttribute("text")?.trim();
  const chord: ChordSymbol = {
    position,
    root,
    quality: kind?.quality ?? "other",
  };
  if (authoredKindText || !kind) chord.kindText = authoredKindText || sourceKind;
  const staff = readStaff(harmony);
  if (staff !== undefined) chord.displayStaff = staff;
  if (kind?.extension !== undefined) chord.extension = kind.extension;
  const bassElement = findChild(harmony, "bass");
  const bass = bassElement ? readRoot(bassElement, "bass") : undefined;
  if (bass) chord.bass = bass;
  return chord;
}

export function isSupportedHarmony(harmony: Element): boolean {
  if (!findChild(harmony, "root")) return false;
  const kind = findChild(harmony, "kind")?.textContent?.trim() ?? "";
  return CHORD_KIND_MAP[kind] !== undefined;
}

export function isPreservableHarmony(harmony: Element): boolean {
  return findChild(harmony, "root") !== null && findChild(harmony, "kind") !== null;
}
