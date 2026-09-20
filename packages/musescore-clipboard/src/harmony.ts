import {
  formatChordSymbolText,
  parseChordSymbolText,
  resolveChordSymbol,
  type ChordRoot,
  type ChordSymbol,
} from "@viritura/core";
import type { Element } from "@xmldom/xmldom";
import { MuseScoreConversionError, unsupported } from "./errors";
import { fromTuple } from "./fractions";
import { validateContainer, validatePropertyContent } from "./notationReading";
import { pitchFromMidiTpc, tpcFromPitch } from "./pitch";
import type { ReadPolicy } from "./readPolicy";
import { child, children, escapeXml, integerText, requiredText, text, validateXmlCharacters } from "./xml";

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

function validateHarmonyProperties(element: Element, path: string, isInfo: boolean, losses: HarmonyLoss[]): void {
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
      if (!independent && !HARMONY_SEMANTICS.has(name)) {
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

function readHarmonyInfo(info: Element, path: string): { root?: ChordRoot; bass?: ChordRoot; name: string } {
  const root = children(info, "root").length
    ? rootFromTpc(integerText(info, "root", `${path}/root`), `${path}/root`)
    : undefined;
  const basses = children(info).filter((item) => item.tagName === "bass" || item.tagName === "base");
  const decodedBasses = basses.map((item) =>
    rootFromTpc(integerText(info, item.tagName, `${path}/${item.tagName}`), `${path}/${item.tagName}`),
  );
  if (basses.length > 1) {
    throw new MuseScoreConversionError("invalid-structure", "ambiguous harmony bass/base", path);
  }
  if (children(info, "extension").length) integerText(info, "extension", `${path}/extension`);
  // A rootless name is literal display text; "=" only denotes implied minor
  // in structured harmony names, not an escape for raw text.
  const name = root ? (text(info, "name") ?? "").replace(/^=/, "") : (child(info, "name")?.textContent ?? "");
  if (!root && !name.trim()) {
    throw new MuseScoreConversionError("invalid-structure", "Harmony requires a root or text name", path);
  }
  return { root, name, ...(decodedBasses[0] ? { bass: decodedBasses[0] } : {}) };
}

function harmonyText(info: ReturnType<typeof readHarmonyInfo>): string {
  const position = { fraction: [0, 1] as [number, number] };
  const root = info.root ? formatChordSymbolText({ position, root: info.root }) : "";
  const bass = info.bass ? `/${formatChordSymbolText({ position, root: info.bass })}` : "";
  return `${root}${info.name}${bass}`;
}

function structuredHarmony(info: ReturnType<typeof readHarmonyInfo>, position: [number, number]): ChordSymbol {
  if (!info.root) return parseChordSymbolText(harmonyText(info), { fraction: position });
  const suffix = parseChordSymbolText(`C${info.name}`, { fraction: position });
  // Root and bass TPCs are authoritative. A suffix such as b5 must not turn C
  // into C-flat power merely because concatenating the source tokens is ambiguous.
  const quality = suffix.root?.step === "C" && !suffix.root.alter && !suffix.bass ? suffix.quality : "other";
  return {
    position: { fraction: position },
    root: info.root,
    quality,
    ...(quality === "other" ? { kindText: info.name } : {}),
    ...(suffix.extension === undefined ? {} : { extension: suffix.extension }),
    ...(info.bass ? { bass: info.bass } : {}),
  };
}

function degreeText(element: Element): string {
  return children(element, "degree")
    .map((degree) => {
      const alteration = Number(text(degree, "degree-alter") ?? 0);
      const accidental = alteration > 0 ? `+${alteration}` : alteration < 0 ? String(alteration) : "";
      return `(${text(degree, "degree-type") ?? "degree"}${accidental}:${text(degree, "degree-value") ?? "?"})`;
    })
    .join("");
}

export function parseHarmony(
  element: Element,
  position: [number, number],
  path: string,
  policy?: ReadPolicy,
): ChordSymbol {
  const losses: HarmonyLoss[] = [];
  validateHarmonyProperties(element, path, false, losses);
  const infos = children(element, "harmonyInfo");
  if (!infos.length) throw new MuseScoreConversionError("invalid-structure", "Harmony requires harmonyInfo", path);
  // Validate every block before any recoverable semantic failure, including
  // blocks that cannot be retained in the native single-chord model.
  const parsed = infos.map((info, index) => {
    const infoPath = `${path}/harmonyInfo${infos.length === 1 ? "" : `[${index}]`}`;
    validateHarmonyProperties(info, infoPath, true, losses);
    return readHarmonyInfo(info, infoPath);
  });
  const semanticLoss = losses.find((loss) => !loss.independent);
  // Clipboard writeHarmonyInfo normalizes root AND bass to concert pitch.
  // Unlike written tpc2 on notes, these TPCs must not use the Staff interval again.
  const rawText =
    text(element, "text") ??
    text(element, "xmlText") ??
    text(element, "function") ??
    parsed.map((info, index) => harmonyText(info) + degreeText(infos[index]!)).join(" | ") + degreeText(element);
  const chord: ChordSymbol = { ...structuredHarmony(parsed[0]!, position), rawText };
  if (semanticLoss || infos.length > 1) chord.quality = "other";
  const resolution = resolveChordSymbol(chord);
  if (resolution.status === "unsupported") {
    policy?.warn(
      `${semanticLoss?.message ?? resolution.message} Preserved harmony as rawText.`,
      semanticLoss?.path ?? path,
    );
    return chord;
  }
  for (const loss of losses) {
    if (loss.independent && policy) policy.skip(loss.message, loss.path);
    else unsupported(loss.message, loss.path);
  }
  // Source spelling is provenance, not an authored display override.
  return chord;
}

function rootTpc(root: ChordRoot): number {
  if (!/^[A-G]$/.test(root.step)) unsupported(`harmony root "${root.step}" is invalid`);
  return tpcFromPitch({
    step: root.step as import("@viritura/core").Step,
    octave: 4,
    ...(root.alter === undefined ? {} : { alter: root.alter }),
  });
}

function harmonyName(chord: ChordSymbol): string {
  if (!chord.root) return formatChordSymbolText(chord);
  const structured = { position: chord.position, root: chord.root, quality: chord.quality, extension: chord.extension };
  const rootText = formatChordSymbolText({ position: chord.position, root: chord.root });
  return formatChordSymbolText(structured).slice(rootText.length);
}

function validateExportHarmony(chord: ChordSymbol, path: string): void {
  const position = chord.position?.fraction;
  if (!Array.isArray(position) || position.length !== 2) {
    throw new MuseScoreConversionError("invalid-timing", "invalid harmony position", path);
  }
  fromTuple(position);
  for (const field of ["root", "bass"] as const) {
    const root = chord[field];
    if (root === undefined) continue;
    if (
      !root ||
      typeof root !== "object" ||
      Array.isArray(root) ||
      typeof root.step !== "string" ||
      !root.step.trim() ||
      (root.alter !== undefined && !Number.isSafeInteger(root.alter))
    ) {
      throw new MuseScoreConversionError("invalid-structure", `invalid harmony ${field}`, path);
    }
  }
  for (const field of ["rawText", "textOverride", "quality", "kindText"] as const) {
    if (chord[field] !== undefined && typeof chord[field] !== "string") {
      throw new MuseScoreConversionError("invalid-structure", `invalid harmony ${field}`, path);
    }
  }
  if (chord.extension !== undefined && !Number.isSafeInteger(chord.extension)) {
    throw new MuseScoreConversionError("invalid-structure", "invalid harmony extension", path);
  }
}

function disambiguatedHarmonyInfo(chord: ChordSymbol, rawText: string, path: string): string {
  const info = { root: chord.root, bass: chord.bass, name: chord.kindText?.trim().replace(/^=/, "") ?? "" };
  if (
    !info.root ||
    harmonyText(info) !== rawText ||
    resolveChordSymbol(structuredHarmony(info, chord.position.fraction)).status !== "unsupported"
  ) {
    unsupported("text-only export of unsupported harmony would change meaning on reimport", path);
  }
  const root = rootTpc(info.root);
  const bass = info.bass ? rootTpc(info.bass) : undefined;
  // The importer accepts only MuseScore's supported TPC range.
  if (root < -1 || root > 33 || (bass !== undefined && (bass < -1 || bass > 33))) {
    unsupported("unsupported harmony requires root or bass outside the MuseScore TPC range", path);
  }
  const name = escapeXml(info.name).replaceAll("\r", "&#13;");
  return `<harmonyInfo><name>${name}</name><root>${root}</root>${bass === undefined ? "" : `<bass>${bass}</bass>`}</harmonyInfo>`;
}

export function serializeHarmony(chord: ChordSymbol, path: string, warnings?: string[]): string {
  // StaffList harmony is concert-pitch wire data, even on a transposing staff.
  // MuseScore's pasteStaff applies its destination written interval itself.
  validateExportHarmony(chord, path);
  const resolution = resolveChordSymbol(chord);
  if (resolution.status === "unsupported") {
    const rawText = chord.textOverride ?? chord.rawText ?? formatChordSymbolText(chord);
    if (!rawText.trim()) {
      throw new MuseScoreConversionError("invalid-structure", "Harmony requires a root or text name", path);
    }
    const name = escapeXml(rawText).replaceAll("\r", "&#13;");
    validateXmlCharacters(name);
    // Raw text alone can turn a suffix accidental into a different, playable root.
    const needsStructure = resolveChordSymbol(parseChordSymbolText(rawText, chord.position)).status !== "unsupported";
    const info = needsStructure
      ? disambiguatedHarmonyInfo(chord, rawText, path)
      : `<harmonyInfo><name>${name}</name></harmonyInfo>`;
    warnings?.push(
      new MuseScoreConversionError(
        "unsupported-content",
        needsStructure
          ? "unsupported harmony preserved with disambiguating root and bass structure"
          : "unsupported harmony preserved as raw text; structured root and bass were not exported",
        path,
      ).userMessage(),
    );
    return `<Harmony>${info}</Harmony>`;
  }
  // Resolve first so unsupported text and contradictory fields cannot be normalized away.
  if (resolution.status === "supported" && !chord.root) {
    chord = parseChordSymbolText(chord.rawText!, chord.position);
  }
  const name = harmonyName(chord);
  const bass = chord.bass ? `<bass>${rootTpc(chord.bass)}</bass>` : "";
  const root = chord.root ? `<root>${rootTpc(chord.root)}</root>` : "";
  return `<Harmony><harmonyInfo><name>${escapeXml(name)}</name>${root}${bass}</harmonyInfo></Harmony>`;
}
