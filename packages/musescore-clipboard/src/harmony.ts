import type { ChordQuality, ChordRoot, ChordSymbol } from "@viritura/core";
import type { Element } from "@xmldom/xmldom";
import { MuseScoreConversionError, unsupported } from "./errors";
import { validateContainer, validatePropertyContent } from "./notationReading";
import { pitchFromMidiTpc, tpcFromPitch } from "./pitch";
import type { ReadPolicy } from "./readPolicy";
import { children, integerText, requiredText, text } from "./xml";

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

const HARMONY_SCALARS = new Set(["name", "root", "bass", "base", "extension"]);
const HARMONY_STYLES = new Set([
  "fontFace",
  "fontSize",
  "fontStyle",
  "sizeSpatiumDependent",
  "color",
  "offset",
  "pos",
  "placement",
  "visible",
  "autoplace",
  "z",
  "style",
  "align",
  "minDistance",
  "frameType",
  "frameWidth",
  "framePadding",
  "frameRound",
  "frameFgColor",
  "frameBgColor",
  "rootCase",
  "bassCase",
  "leftParen",
  "rightParen",
]);
const HARMONY_SEMANTICS = new Set(["harmonyType", "function", "text", "xmlText"]);
const DEGREE_SCALARS = new Set(["degree-value", "degree-alter", "degree-type"]);

interface HarmonyLoss {
  message: string;
  path: string;
  independent: boolean;
}

function validateUnsupportedProperty(item: Element, path: string): void {
  if (item.tagName !== "degree") {
    validatePropertyContent(item, path);
    return;
  }
  validateContainer(item, [], path);
  const seen = new Set<string>();
  for (const field of children(item)) {
    const name = field.tagName;
    const fieldPath = `${path}/${name}`;
    if (!DEGREE_SCALARS.has(name) || seen.has(name) || field.children.length || field.attributes.length) {
      throw new MuseScoreConversionError("invalid-structure", "invalid harmony degree field", fieldPath);
    }
    seen.add(name);
    if (name === "degree-type") requiredText(item, name, fieldPath);
    else integerText(item, name, fieldPath);
  }
}

function validateHarmonyProperties(
  element: Element,
  path: string,
  isInfo: boolean,
  losses: HarmonyLoss[],
  policy?: ReadPolicy,
): void {
  validateContainer(element, [], path);
  const seen = new Set<string>();
  for (const item of children(element)) {
    const name = item.tagName;
    const propertyPath = `${path}/${name}`;
    if (!isInfo && name === "harmonyInfo") continue;
    if (name !== "degree" && seen.has(name)) {
      throw new MuseScoreConversionError("invalid-structure", `duplicate harmony ${name}`, propertyPath);
    }
    seen.add(name);
    if (name === "degree") {
      losses.push({
        message: "altered/add/subtract harmony degrees are not representable",
        path: propertyPath,
        independent: false,
      });
    } else if (isInfo && HARMONY_SCALARS.has(name)) {
      if (item.attributes.length || item.children.length) {
        throw new MuseScoreConversionError("invalid-structure", `${name} must be a single scalar`, propertyPath);
      }
      continue;
    } else {
      const independent = HARMONY_STYLES.has(name) || name === "play";
      if (!independent && !HARMONY_SEMANTICS.has(name) && policy?.skipUnsupported) {
        throw new MuseScoreConversionError(
          "invalid-structure",
          `unknown ${element.tagName} property "${name}"`,
          propertyPath,
        );
      }
      losses.push({
        message: `${element.tagName} property "${name}" is not supported`,
        path: propertyPath,
        independent,
      });
    }
    validateUnsupportedProperty(item, propertyPath);
  }
}

function readHarmonyInfo(info: Element, path: string): { root: ChordRoot; bass?: ChordRoot; name: string } {
  const root = rootFromTpc(integerText(info, "root", `${path}/root`), `${path}/root`);
  const basses = children(info).filter((item) => item.tagName === "bass" || item.tagName === "base");
  const decodedBasses = basses.map((item) =>
    rootFromTpc(integerText(info, item.tagName, `${path}/${item.tagName}`), `${path}/${item.tagName}`),
  );
  if (basses.length > 1) {
    throw new MuseScoreConversionError("invalid-structure", "ambiguous harmony bass/base", path);
  }
  if (children(info, "extension").length) integerText(info, "extension", `${path}/extension`);
  const name = (text(info, "name") ?? "").replace(/^=/, "");
  return { root, name, ...(decodedBasses[0] ? { bass: decodedBasses[0] } : {}) };
}

export function parseHarmony(
  element: Element,
  position: [number, number],
  path: string,
  policy?: ReadPolicy,
): ChordSymbol {
  const losses: HarmonyLoss[] = [];
  validateHarmonyProperties(element, path, false, losses, policy);
  const infos = children(element, "harmonyInfo");
  if (!infos.length) throw new MuseScoreConversionError("invalid-structure", "Harmony requires harmonyInfo", path);
  // Validate every block before any recoverable semantic failure, including
  // blocks that cannot be retained in the native single-chord model.
  const parsed = infos.map((info, index) => {
    const infoPath = `${path}/harmonyInfo${infos.length === 1 ? "" : `[${index}]`}`;
    validateHarmonyProperties(info, infoPath, true, losses, policy);
    return readHarmonyInfo(info, infoPath);
  });
  if (infos.length > 1) unsupported("multiple harmonyInfo blocks are not representable", path);
  const { root, bass, name } = parsed[0]!;
  const kind = Object.hasOwn(IMPORT_KINDS, name) ? IMPORT_KINDS[name] : undefined;
  if (!kind) unsupported(`harmony name "${name}" is not supported`, `${path}/harmonyInfo/name`);
  const semanticLoss = losses.find((loss) => !loss.independent);
  if (semanticLoss) unsupported(semanticLoss.message, semanticLoss.path);
  for (const loss of losses) {
    if (loss.independent && policy) policy.skip(loss.message, loss.path);
    else unsupported(loss.message, loss.path);
  }
  return {
    position: { fraction: position },
    root,
    quality: kind.quality,
    ...(kind.extension === undefined ? {} : { extension: kind.extension }),
    ...(bass ? { bass } : {}),
  };
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
