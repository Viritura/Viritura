import type { ChordQuality, ChordRoot, ChordSymbol } from "@viritura/core";
import { MuseScoreConversionError, unsupported } from "./errors";
import { pitchFromMidiTpc, tpcFromPitch } from "./pitch";
import { child, children, integerText, text } from "./xml";

interface HarmonyKind {
  quality: ChordQuality;
  extension?: ChordSymbol["extension"];
}

const IMPORT_KINDS: Record<string, HarmonyKind> = {
  "": { quality: "major" },
  M: { quality: "major" },
  maj: { quality: "major" },
  m: { quality: "minor" },
  dim: { quality: "diminished" },
  aug: { quality: "augmented" },
  "+": { quality: "augmented" },
  "7": { quality: "dominant", extension: 7 },
  maj7: { quality: "major", extension: 7 },
  M7: { quality: "major", extension: 7 },
  m7: { quality: "minor", extension: 7 },
  dim7: { quality: "diminished", extension: 7 },
  m7b5: { quality: "half-diminished", extension: 7 },
  ø7: { quality: "half-diminished", extension: 7 },
  "6": { quality: "major", extension: 6 },
  m6: { quality: "minor", extension: 6 },
  "9": { quality: "dominant", extension: 9 },
  maj9: { quality: "major", extension: 9 },
  m9: { quality: "minor", extension: 9 },
  "11": { quality: "dominant", extension: 11 },
  m11: { quality: "minor", extension: 11 },
  "13": { quality: "dominant", extension: 13 },
  m13: { quality: "minor", extension: 13 },
  sus2: { quality: "suspended2" },
  sus4: { quality: "suspended4" },
  "5": { quality: "power" },
};

function rootFromTpc(tpc: number, path: string): ChordRoot {
  const pitch = pitchFromMidiTpc(60 + (((((tpc - 14) * 7) % 12) + 12) % 12), tpc, path);
  return pitch.alter === undefined ? { step: pitch.step } : { step: pitch.step, alter: pitch.alter };
}

export function parseHarmony(element: Element, position: [number, number], path: string): ChordSymbol {
  for (const item of children(element)) {
    if (item.tagName !== "harmonyInfo" && item.tagName !== "degree") {
      unsupported(`Harmony property "${item.tagName}" is not supported`, `${path}/${item.tagName}`);
    }
  }
  const infos = children(element, "harmonyInfo");
  if (infos.length !== 1) unsupported("multiple harmonyInfo blocks are not representable", path);
  const info = infos[0];
  if (!info) throw new MuseScoreConversionError("invalid-structure", "Harmony requires harmonyInfo", path);
  if (children(info, "degree").length > 0 || children(element, "degree").length > 0) {
    unsupported("altered/add/subtract harmony degrees are not representable", path);
  }
  for (const item of children(info)) {
    if (!new Set(["name", "root", "bass", "base", "extension"]).has(item.tagName)) {
      unsupported(`harmonyInfo property "${item.tagName}" is not supported`, `${path}/harmonyInfo/${item.tagName}`);
    }
  }
  const name = (text(info, "name") ?? "").replace(/^=/, "");
  const kind = IMPORT_KINDS[name];
  if (!kind) unsupported(`harmony name "${name}" is not supported`, `${path}/harmonyInfo/name`);
  const root = integerText(info, "root", `${path}/harmonyInfo/root`);
  const chord: ChordSymbol = { position: { fraction: position }, root: rootFromTpc(root, path), quality: kind.quality };
  if (kind.extension !== undefined) chord.extension = kind.extension;
  const bassElement = child(info, "bass") ?? child(info, "base");
  if (bassElement) {
    const bass = Number(bassElement.textContent?.trim());
    if (!Number.isInteger(bass)) throw new MuseScoreConversionError("invalid-structure", "invalid harmony bass", path);
    chord.bass = rootFromTpc(bass, path);
  }
  return chord;
}

const QUALITY_NAMES: Partial<Record<ChordQuality, string>> = {
  major: "",
  minor: "m",
  augmented: "aug",
  diminished: "dim",
  dominant: "",
  "half-diminished": "m7b5",
  power: "5",
  suspended2: "sus2",
  suspended4: "sus4",
};

function rootTpc(root: ChordRoot): number {
  if (!/^[A-G]$/.test(root.step)) unsupported(`harmony root "${root.step}" is invalid`);
  return tpcFromPitch({
    step: root.step as import("@viritura/core").Step,
    octave: 4,
    ...(root.alter === undefined ? {} : { alter: root.alter }),
  });
}

export function harmonyName(chord: ChordSymbol, path: string): string {
  if (chord.textOverride || chord.kindText) unsupported("authored harmony text cannot be exported losslessly", path);
  let name = QUALITY_NAMES[chord.quality];
  if (name === undefined) unsupported(`harmony quality "${chord.quality}" is not supported`, path);
  if (chord.extension !== undefined) {
    if (chord.quality === "major" && chord.extension === 7) name = "maj7";
    else if (chord.quality === "major" && chord.extension > 7) name = `maj${chord.extension}`;
    else if (chord.quality === "minor") name = `m${chord.extension}`;
    else if (chord.quality === "half-diminished") name = "m7b5";
    else name = `${name}${chord.extension}`;
  }
  return name;
}

export function serializeHarmony(chord: ChordSymbol, path: string): string {
  const name = harmonyName(chord, path);
  const bass = chord.bass ? `<bass>${rootTpc(chord.bass)}</bass>` : "";
  return `<Harmony><harmonyInfo><name>${name}</name><root>${rootTpc(chord.root)}</root>${bass}</harmonyInfo></Harmony>`;
}
