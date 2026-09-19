import { createDynamicGroup, type DynamicValue, type Markings } from "@viritura/core";
import type { Element } from "@xmldom/xmldom";
import { MuseScoreConversionError, unsupported } from "./errors";
import { tuple, type Fraction } from "./fractions";
import type { ReadPolicy } from "./readPolicy";
import type { MuseScoreClipboardDynamic } from "./types";
import { children, requiredText } from "./xml";

const STYLE_PROPERTIES = new Set([
  "color",
  "offset",
  "pos",
  "autoplace",
  "placement",
  "direction",
  "visible",
  "small",
  "z",
  "minDistance",
  "fontFace",
  "fontSize",
  "fontStyle",
  "style",
  "align",
  "sizeSpatiumDependent",
  "frameType",
  "frameWidth",
  "framePadding",
  "frameRound",
  "frameFgColor",
  "frameBgColor",
]);
const COLOR_PROPERTIES = new Set(["color", "frameFgColor", "frameBgColor"]);
const POINT_PROPERTIES = new Set(["offset", "pos", "p1", "p2"]);
const TEXT_PROPERTIES = new Set(["text", "xmlText"]);
const TEXT_MARKUP = new Set(["b", "i", "u", "s", "sub", "sup"]);
const NOTE_DECORATIONS = new Set(["Bend", "NoteDot"]);
const EVENT_DECORATIONS = new Set([
  "Articulation",
  "Symbol",
  "Ornament",
  "Lyrics",
  "Arpeggio",
  "Tremolo",
  "TremoloSingleChord",
  "TremoloTwoChord",
  "Fermata",
  "ChordLine",
  "Stem",
  "Hook",
  "Beam",
  "Fingering",
]);
const EVENT_PROPERTIES = new Set([
  ...STYLE_PROPERTIES,
  ...EVENT_DECORATIONS,
  "stemDirection",
  "noStem",
  "beamMode",
  "BeamMode",
  "staffMove",
  "play",
  "leadingSpace",
  "trailingSpace",
]);
const TUPLET_PROPERTIES = new Set([
  ...STYLE_PROPERTIES,
  "Number",
  "numberType",
  "bracketType",
  "direction",
  "p1",
  "p2",
]);
const STAFF_ANNOTATIONS = new Set([
  "StaffText",
  "SystemText",
  "Text",
  "Tempo",
  "TempoText",
  "RehearsalMark",
  "Fermata",
  "Breath",
  "Symbol",
  "Image",
  "FretDiagram",
  "FiguredBass",
  "PlayTechAnnotation",
  "Expression",
  "InstrumentChange",
  "Articulation",
  "Ornament",
]);
const DECORATION_PROPERTIES = new Set([
  ...STYLE_PROPERTIES,
  ...TEXT_PROPERTIES,
  "subtype",
  "name",
  "play",
  "tempo",
  "followText",
  "syllabic",
  "verse",
  "no",
]);
// MuseScore 4.7.5 rw/write/twrite.cpp and rw/read460/tread.cpp:
// Ornament adds these scalars to Articulation; intervals are comma-separated text.
const ORNAMENT_PROPERTIES = new Set([
  ...DECORATION_PROPERTIES,
  "startOnUpperNote",
  "intervalAbove",
  "intervalBelow",
  "ornamentShowAccidental",
  "ornamentShowCueNote",
  "ornamentStyle",
  "anchor",
  "channel",
  "channe", // The pinned writer omits the final "l"; the reader uses "channel".
]);

export function validateContainer(element: Element, attributes: readonly string[], path: string): void {
  for (const attribute of Array.from(element.attributes)) {
    if (!attributes.includes(attribute.name)) {
      throw new MuseScoreConversionError(
        "invalid-structure",
        `unknown ${element.tagName} attribute "${attribute.name}"`,
        path,
      );
    }
  }
  for (const node of Array.from(element.childNodes)) {
    if ((node.nodeType === 3 || node.nodeType === 4) && node.textContent?.trim()) {
      throw new MuseScoreConversionError("invalid-structure", `unexpected ${element.tagName} text`, path);
    }
  }
}

function validateTextContent(element: Element, path: string): void {
  if (element.attributes.length) {
    throw new MuseScoreConversionError("invalid-structure", "unexpected text attributes", path);
  }
  for (const item of children(element)) {
    const itemPath = `${path}/${item.tagName}`;
    if (TEXT_MARKUP.has(item.tagName)) {
      validateTextContent(item, itemPath);
    } else if (item.tagName === "sym") {
      if (item.children.length || item.attributes.length) {
        throw new MuseScoreConversionError("invalid-structure", "invalid text symbol", itemPath);
      }
    } else if (item.tagName === "font" || item.tagName === "br") {
      validateContainer(item, item.tagName === "font" ? ["face", "size"] : [], itemPath);
      if (item.children.length) {
        throw new MuseScoreConversionError("invalid-structure", "unexpected text markup content", itemPath);
      }
    } else {
      throw new MuseScoreConversionError("invalid-structure", "unknown text markup", itemPath);
    }
  }
}

/** Validate discarded properties too: a familiar tag does not make its contents safe. */
export function validatePropertyContent(element: Element, path: string): void {
  if (TEXT_PROPERTIES.has(element.tagName)) {
    validateTextContent(element, path);
    return;
  }
  const attributes = COLOR_PROPERTIES.has(element.tagName)
    ? ["r", "g", "b", "a"]
    : POINT_PROPERTIES.has(element.tagName)
      ? ["x", "y"]
      : [];
  if (attributes.length) validateContainer(element, attributes, path);
  if (element.children.length || Array.from(element.attributes).some((item) => !attributes.includes(item.name))) {
    throw new MuseScoreConversionError("invalid-structure", `${element.tagName} must be scalar`, path);
  }
}

/** A known decoration is atomic, not a wrapper in which rhythmic material can be hidden. */
export function validateDecoration(element: Element, path: string): void {
  if (
    !EVENT_DECORATIONS.has(element.tagName) &&
    !STAFF_ANNOTATIONS.has(element.tagName) &&
    !NOTE_DECORATIONS.has(element.tagName) &&
    element.tagName !== "Number"
  ) {
    validatePropertyContent(element, path);
    return;
  }
  validateContainer(element, [], path);
  const properties = element.tagName === "Ornament" ? ORNAMENT_PROPERTIES : DECORATION_PROPERTIES;
  const seen = new Set<string>();
  for (const item of children(element)) {
    const itemPath = `${path}/${item.tagName}`;
    if (element.tagName === "Bend" && item.tagName === "point") {
      validateContainer(item, ["time", "pitch", "vibrato"], itemPath);
      if (item.children.length) {
        throw new MuseScoreConversionError("invalid-structure", "bend point must be attribute-only", itemPath);
      }
      continue;
    }
    if (!properties.has(item.tagName) || seen.has(item.tagName)) {
      throw new MuseScoreConversionError("invalid-structure", "unknown or duplicate decoration property", itemPath);
    }
    seen.add(item.tagName);
    if (element.tagName === "Ornament" && (item.tagName === "channel" || item.tagName === "channe")) {
      validateContainer(item, ["name"], itemPath);
      if (item.children.length) {
        throw new MuseScoreConversionError("invalid-structure", "ornament channel must be attribute-only", itemPath);
      }
    } else {
      validatePropertyContent(item, itemPath);
    }
  }
}

export function skipStaffAnnotation(element: Element, path: string, time: string, policy: ReadPolicy): void {
  if (!STAFF_ANNOTATIONS.has(element.tagName)) {
    unsupported(`StaffList element "${element.tagName}" has unknown timing or structure`, path, time);
  }
  validateDecoration(element, path);
  policy.skip(`StaffList annotation "${element.tagName}" is not supported`, path, time);
}

export function validateNotationProperties(
  element: Element,
  supported: readonly string[],
  compounds: readonly string[],
  path: string,
  policy: ReadPolicy,
): void {
  if (policy.skipUnsupported) validateContainer(element, [], path);
  const seen = new Set<string>();
  const skippable = element.tagName === "Tuplet" ? TUPLET_PROPERTIES : EVENT_PROPERTIES;
  for (const item of children(element)) {
    const name = item.tagName;
    const itemPath = `${path}/${name}`;
    if (!supported.includes(name)) {
      if (!skippable.has(name))
        unsupported(`${element.tagName} property "${name}" has unknown timing or structure`, itemPath);
      validateDecoration(item, itemPath);
      policy.skip(`${element.tagName} property "${name}" is not supported`, itemPath);
      continue;
    }
    if (compounds.includes(name)) continue;
    if (seen.has(name) || item.children.length || item.attributes.length) {
      throw new MuseScoreConversionError("invalid-structure", `${name} must be a single scalar`, itemPath);
    }
    seen.add(name);
  }
}

function validateAnnotationProperties(
  element: Element,
  supported: readonly string[],
  path: string,
  policy: ReadPolicy,
  discarded: readonly string[] = [],
): void {
  if (policy.skipUnsupported) validateContainer(element, [], path);
  const losses: string[] = [];
  const seen = new Set<string>();
  for (const item of children(element)) {
    const name = item.tagName;
    const propertyPath = `${path}/${name}`;
    if (!supported.includes(name)) {
      if (!STYLE_PROPERTIES.has(name) && !discarded.includes(name)) {
        throw new MuseScoreConversionError(
          policy.skipUnsupported ? "invalid-structure" : "unsupported-content",
          `${element.tagName} property "${name}" is not supported`,
          propertyPath,
        );
      }
      losses.push(name);
    }
    if (seen.has(name)) {
      throw new MuseScoreConversionError("invalid-structure", `duplicate ${element.tagName} ${name}`, propertyPath);
    }
    seen.add(name);
    validatePropertyContent(item, propertyPath);
  }
  for (const name of losses) policy.skip(`${element.tagName} property "${name}" is not supported`, `${path}/${name}`);
}

export function parseMarkings(chord: Element, path: string, policy: ReadPolicy): Markings | undefined {
  const markings: Markings = {};
  const articulations = new Map<string, keyof Markings>([
    ["articStaccato", "staccato"],
    ["articTenuto", "tenuto"],
    ["articAccent", "accent"],
    ["articMarcato", "strongAccent"],
    ["articStaccatissimo", "staccatissimo"],
    ["articSpiccato", "spiccato"],
  ]);
  for (const [index, articulation] of children(chord, "Articulation").entries()) {
    const itemPath = `${path}/Articulation[${index}]`;
    validateAnnotationProperties(articulation, ["subtype"], itemPath, policy, ["play"]);
    const subtype = requiredText(articulation, "subtype", itemPath);
    const marking = articulations.get(subtype.replace(/(?:Above|Below)$/, ""));
    if (marking) Object.assign(markings, { [marking]: {} });
    else policy.skip(`articulation "${subtype}" is not supported`, `${itemPath}/subtype`);
  }
  for (const [index, symbol] of children(chord, "Symbol").entries()) {
    const itemPath = `${path}/Symbol[${index}]`;
    validateAnnotationProperties(symbol, ["name"], itemPath, policy);
    const name = requiredText(symbol, "name", itemPath);
    if (name === "ornamentTrill") markings.trill = {};
    else policy.skip(`symbol "${name}" is not supported`, `${itemPath}/name`);
  }
  return Object.keys(markings).length > 0 ? markings : undefined;
}

const DYNAMIC_VALUES = new Set<DynamicValue>([
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

export function parseDynamic(
  element: Element,
  offset: Fraction,
  path: string,
  policy: ReadPolicy,
): MuseScoreClipboardDynamic {
  validateAnnotationProperties(
    element,
    ["subtype", "velocity", "play", "veloChange", "veloChangeSpeed", ...TEXT_PROPERTIES],
    path,
    policy,
  );
  const subtype = requiredText(element, "subtype", `${path}/subtype`) as DynamicValue;
  if (!DYNAMIC_VALUES.has(subtype)) unsupported(`dynamic "${subtype}" is not supported`, path);
  if (children(element).some((item) => TEXT_PROPERTIES.has(item.tagName))) {
    unsupported("custom dynamic text is not supported", path);
  }
  // Playback scalars are intentionally not copied into semantic dynamics.
  return { measureOffset: 0, offset: tuple(offset), dynamic: createDynamicGroup(subtype, { fraction: [0, 1] }) };
}
