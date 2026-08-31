import { generateId } from "../id";
import type {
  DynamicGroup,
  DynamicPrefix,
  DynamicSuffix,
  DynamicValue,
  RelativeDynamicValue,
  RhythmicPosition,
} from "../model/measure";

/** Dynamic spellings exposed by authoring and interchange surfaces. */
export type AuthoredDynamicValue =
  | DynamicValue
  | "fp"
  | "pf"
  | "sf"
  | "sfp"
  | "sfpp"
  | "sfz"
  | "sffz"
  | "fz"
  | "rf"
  | "rfz";

const PRECOMPOSED_GLYPHS: Readonly<Record<string, string>> = {
  pppppp: "dynamicPPPPPP",
  ppppp: "dynamicPPPPP",
  pppp: "dynamicPPPP",
  ffff: "dynamicFFFF",
  fffff: "dynamicFFFFF",
  ffffff: "dynamicFFFFFF",
  fp: "dynamicFortePiano",
  pf: "dynamicPF",
  sf: "dynamicSforzando1",
  sfp: "dynamicSforzandoPiano",
  sfpp: "dynamicSforzandoPianissimo",
  sfz: "dynamicSforzato",
  sffz: "dynamicSforzatoFF",
  fz: "dynamicForzando",
  rf: "dynamicRinforzando1",
  rfz: "dynamicRinforzando2",
};

const LETTER_GLYPHS: Readonly<Record<string, string>> = {
  p: "dynamicPiano",
  m: "dynamicMezzo",
  f: "dynamicForte",
  r: "dynamicRinforzando",
  s: "dynamicSforzando",
  z: "dynamicZ",
  n: "dynamicNiente",
};

const SUPPORTED_DYNAMIC_GLYPHS = new Set([
  ...Object.values(PRECOMPOSED_GLYPHS),
  ...Object.values(LETTER_GLYPHS),
  "dynamicPPP",
  "dynamicPP",
  "dynamicMP",
  "dynamicMF",
  "dynamicFF",
  "dynamicFFF",
  "dynamicSforzatoPiano",
]);

/** Whether a SMuFL glyph name can be rendered as part of a dynamic group. */
export function isSupportedDynamicGlyph(name: string): boolean {
  return SUPPORTED_DYNAMIC_GLYPHS.has(name);
}

const STANDARD_VALUES = new Set<DynamicValue>([
  "pppppp",
  "ppppp",
  "pppp",
  "ppp",
  "pp",
  "p",
  "mp",
  "mf",
  "f",
  "ff",
  "fff",
  "ffff",
  "fffff",
  "ffffff",
  "n",
]);

const STANDARD_VALUE_GLYPHS: Readonly<Record<DynamicValue, string>> = {
  n: "dynamicNiente",
  pppppp: "dynamicPPPPPP",
  ppppp: "dynamicPPPPP",
  pppp: "dynamicPPPP",
  ppp: "dynamicPPP",
  pp: "dynamicPP",
  p: "dynamicPiano",
  mp: "dynamicMP",
  mf: "dynamicMF",
  f: "dynamicForte",
  ff: "dynamicFF",
  fff: "dynamicFFF",
  ffff: "dynamicFFFF",
  fffff: "dynamicFFFFF",
  ffffff: "dynamicFFFFFF",
};

function semanticValue(spelling: string): DynamicValue {
  if (STANDARD_VALUES.has(spelling as DynamicValue)) return spelling as DynamicValue;
  if (/^p+$/.test(spelling)) return "pppppp";
  if (/^f+$/.test(spelling)) return "ffffff";
  if (spelling.endsWith("pp")) return "pp";
  if (spelling.endsWith("p")) return "p";
  if (spelling.includes("ff")) return "ff";
  return "f";
}

function displayGlyphs(spelling: string): string[] | undefined {
  // Values the engine already resolves from `value` need no override.
  if (STANDARD_VALUES.has(spelling as DynamicValue)) return undefined;
  const precomposed = PRECOMPOSED_GLYPHS[spelling];
  if (precomposed) return [precomposed];
  const glyphs = [...spelling]
    .map((letter) => LETTER_GLYPHS[letter])
    .filter((name): name is string => name !== undefined);
  return glyphs.length === spelling.length ? glyphs : undefined;
}

function explicitDisplayGlyphs(spelling: string): string[] | undefined {
  const precomposed = PRECOMPOSED_GLYPHS[spelling];
  if (precomposed) return [precomposed];
  const standard = STANDARD_VALUE_GLYPHS[spelling as DynamicValue];
  if (standard) return [standard];
  return displayGlyphs(spelling);
}

/** Structural decomposition of an accent spelling such as `sfz`, `rf`, or `fp`. */
interface AccentParts {
  accentPrefix: DynamicPrefix;
  value: DynamicValue;
  residualValue?: DynamicValue;
  accentSuffix: DynamicSuffix;
}

// A written accent breaks into an optional `s`/`r`, the attack level, an
// optional residual level, and an optional trailing `z`.
const ACCENT_PATTERN = /^([sr]?)(p+|f+|mp|mf|n)(p+|f+)?(z?)$/;

/** Whether a written dynamic spells an accent rather than a plain level. */
function isAccentSpelling(spelling: string): boolean {
  const parts = ACCENT_PATTERN.exec(spelling);
  if (!parts) return false;
  // `s`/`r`/`z` always mark an accent; otherwise a two-level spelling such as
  // "fp" does, because a plain level never mixes forte and piano.
  return parts[1] !== "" || parts[4] !== "" || parts[3] !== undefined;
}

/** Split a written accent into the structural parts MNX encodes. */
function accentParts(spelling: string): AccentParts | undefined {
  const parts = ACCENT_PATTERN.exec(spelling);
  if (!parts) return undefined;
  const [, prefix, attack, residual, suffix] = parts;
  if (attack === undefined) return undefined;
  return {
    accentPrefix: (prefix ?? "") as DynamicPrefix,
    value: semanticValue(attack),
    ...(residual ? { residualValue: semanticValue(residual) } : {}),
    accentSuffix: (suffix ?? "") as DynamicSuffix,
  };
}

/**
 * Reassemble the written spelling of an accent group. MNX defaults the prefix
 * to `s` and the suffix to `z`, so a bare `{type: "accent", value: "f"}` spells
 * `sfz`.
 */
export function accentSpelling(
  group: Pick<DynamicGroup, "accentPrefix" | "value" | "residualValue" | "accentSuffix">,
): string {
  const prefix = group.accentPrefix ?? "s";
  const suffix = group.accentSuffix ?? "z";
  return `${prefix}${group.value ?? ""}${group.residualValue ?? ""}${suffix}`;
}

/**
 * The written spelling a dynamic group renders as, ignoring any explicit glyph
 * override. Mirrors the engine's `DynamicGroup::display_value`.
 */
export function dynamicSpelling(group: DynamicGroup): string {
  if (group.type === "accent") return accentSpelling(group);
  if (group.value !== undefined) return group.value;
  if (group.relativeValue === "louder") return "f";
  if (group.relativeValue === "softer") return "p";
  return "";
}

/**
 * Build an MNX dynamic group from an authored dynamic spelling.
 *
 * Accents are encoded structurally (`accentPrefix` / `value` / `residualValue` /
 * `accentSuffix`) rather than as a glyph list, so the spelling round-trips
 * without an override. The engine derives the SMuFL glyphs from those parts.
 */
export function createDynamicGroup(spelling: string, position: RhythmicPosition, id = generateId()): DynamicGroup {
  const parts = isAccentSpelling(spelling) ? accentParts(spelling) : undefined;
  if (parts) {
    const { accentPrefix, value, residualValue, accentSuffix } = parts;
    return {
      id,
      type: "accent",
      position,
      value,
      ...(residualValue ? { residualValue } : {}),
      // Only record affixes that differ from the "sfz" defaults.
      ...(accentPrefix === "s" ? {} : { accentPrefix }),
      ...(accentSuffix === "z" ? {} : { accentSuffix }),
    };
  }

  const value = semanticValue(spelling);
  const glyphs = displayGlyphs(spelling);
  return { id, type: "immediate", position, value, ...(glyphs ? { glyphs } : {}) };
}

/** Build a schema-19 relative group while preserving its written dynamic glyph. */
export function createRelativeDynamicGroup(
  spelling: string,
  relativeValue: RelativeDynamicValue,
  position: RhythmicPosition,
  prefix?: string,
  id = generateId(),
): DynamicGroup {
  const glyphs = explicitDisplayGlyphs(spelling);
  return {
    id,
    type: "relative",
    position,
    relativeValue,
    ...(glyphs ? { glyphs } : {}),
    ...(prefix ? { prefix } : {}),
  };
}
