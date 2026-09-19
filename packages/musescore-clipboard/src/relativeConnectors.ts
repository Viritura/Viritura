import type { Element } from "@xmldom/xmldom";
import { MuseScoreConversionError, unsupported } from "./errors";
import { ZERO, add, compare, formatFraction, isZero, parseFraction, subtract, type Fraction } from "./fractions";
import type { ReadPolicy } from "./readPolicy";
import { child, children, integerText, text } from "./xml";

export interface ConnectorLocation {
  staff: number;
  voice: number;
  time: Fraction;
  note: number;
}

export interface RelativeConnector {
  type: "Tie" | "HairPin" | "Slur";
  direction: "next" | "prev";
  current: ConnectorLocation;
  target: ConnectorLocation;
  body?: Element;
  path: string;
  rejected?: boolean;
  unresolvedAnchor?: boolean;
  partial?: boolean;
}

function validateConnectorChildren(
  element: Element,
  allowed: readonly string[],
  path: string,
  containers: readonly string[] = [],
): void {
  const seen = new Set<string>();
  for (const item of children(element)) {
    if (allowed.includes(item.tagName) && seen.has(item.tagName)) {
      throw new MuseScoreConversionError("invalid-structure", `duplicate connector ${item.tagName}`, path);
    }
    if (allowed.includes(item.tagName) && !containers.includes(item.tagName)) {
      if (children(item).length > 0) {
        throw new MuseScoreConversionError(
          "invalid-structure",
          "connector scalar properties cannot contain nested elements",
          path,
        );
      }
      if (item.attributes.length > 0) {
        throw new MuseScoreConversionError(
          "invalid-structure",
          "connector scalar properties cannot contain attributes",
          path,
        );
      }
    }
    seen.add(item.tagName);
  }
}

function validateContainer(element: Element, attributes: readonly string[] | undefined, path: string): void {
  if (attributes && Array.from(element.attributes).some((attribute) => !attributes.includes(attribute.name))) {
    throw new MuseScoreConversionError("invalid-structure", "unknown connector attributes", path);
  }
  if (
    Array.from(element.childNodes).some(
      (node) => (node.nodeType === 3 || node.nodeType === 4) && node.nodeValue?.trim(),
    )
  ) {
    throw new MuseScoreConversionError("invalid-structure", "connector containers cannot contain raw text", path);
  }
}

function validateStructure(
  element: Element,
  allowed: readonly string[],
  containers: readonly string[],
  path: string,
): void {
  validateContainer(element, element.tagName === "Spanner" ? ["type"] : [], path);
  validateConnectorChildren(element, allowed, path, containers);
  for (const item of children(element)) {
    if (!allowed.includes(item.tagName)) {
      throw new MuseScoreConversionError("invalid-structure", `unknown connector property "${item.tagName}"`, path);
    }
  }
}

const BODY_SCALARS = [
  "ticks_f",
  "up",
  "lineType",
  "partialSpannerDirection",
  "subtype",
  "veloChange",
  "singleNoteDynamics",
  "veloChangeMethod",
  "play",
  "visible",
  "autoplace",
  "placement",
  "minDistance",
  "height",
  "contHeight",
  "lineWidth",
  "lineStyle",
  "anchor",
  "dashLineLen",
  "dashGapLen",
  "beginText",
  "continueText",
  "endText",
  "beginHookType",
  "endHookType",
  "beginHookHeight",
  "endHookHeight",
  "text",
  "showText",
  "glissandoStyle",
  "glissandoType",
  "ottavaType",
  "numbersOnly",
  "trillType",
  "vibratoType",
  "circledTip",
  "useTextLine",
  "lineVisible",
  "diagonal",
  "hairpinHeight",
  "hairpinContHeight",
  "beginFontFace",
  "beginFontSize",
  "beginFontStyle",
  "beginTextAlign",
  "beginTextPlace",
  "continueFontFace",
  "continueFontSize",
  "continueFontStyle",
  "continueTextAlign",
  "continueTextPlace",
  "endFontFace",
  "endFontSize",
  "endFontStyle",
  "endTextAlign",
  "endTextPlace",
] as const;
const BODY_POINTS = ["offset", "offset2", "o1", "o2", "o3", "o4"];
const BODY_SEGMENTS = ["SlurSegment", "TieSegment", "HairPinSegment", "Segment"];
const SEGMENT_SCALARS = ["visible", "autoplace", "minDistance"];
const CONNECTOR_TYPES = [
  "Tie",
  "Slur",
  "HairPin",
  "Glissando",
  "Ottava",
  "Pedal",
  "TextLine",
  "Trill",
  "Vibrato",
  "LetRing",
  "PalmMute",
  "Volta",
];

function validateBody(element: Element, path: string, segment = false): void {
  validateContainer(element, segment ? ["no"] : undefined, path);
  const scalars: readonly string[] = segment ? SEGMENT_SCALARS : BODY_SCALARS;
  validateConnectorChildren(element, scalars, path);
  for (const item of children(element)) {
    if (scalars.includes(item.tagName)) continue;
    if (!segment && BODY_SEGMENTS.includes(item.tagName)) {
      validateBody(item, path, true);
      continue;
    }
    if (BODY_POINTS.includes(item.tagName) || item.tagName === "color") {
      validateContainer(item, item.tagName === "color" ? ["r", "g", "b", "a"] : ["x", "y"], path);
      if (children(item).length > 0) {
        throw new MuseScoreConversionError(
          "invalid-structure",
          "connector geometry cannot contain nested elements",
          path,
        );
      }
      continue;
    }
    throw new MuseScoreConversionError(
      "invalid-structure",
      `connector property "${item.tagName}" is not supported in this structure`,
      path,
    );
  }
  for (const field of element.tagName === "HairPin" ? ["lineType", "subtype"] : ["lineType"]) {
    if (text(element, field) !== undefined) integerText(element, field, path);
  }
  const ticks = text(element, "ticks_f");
  if (ticks !== undefined) parseFraction(ticks, path);
}

export function connectorChildren(element: Element, allowed: readonly string[], path: string): void {
  validateConnectorChildren(element, allowed, path);
  if (element.attributes.length > 0) unsupported(`${element.tagName} body attributes are not supported`, path);
  for (const item of children(element)) {
    if (!allowed.includes(item.tagName)) unsupported(`connector property "${item.tagName}" is not supported`, path);
  }
}

export function connectorLocationKey(location: ConnectorLocation): string {
  return `${location.staff}:${location.voice}:${formatFraction(location.time)}:${location.note}`;
}

function relativeTarget(element: Element, current: ConnectorLocation, path: string): ConnectorLocation {
  const time = text(element, "fractions");
  return {
    staff: current.staff + integerText(element, "staves", path, 0),
    voice: current.voice + integerText(element, "voices", path, 0),
    note: current.note + integerText(element, "notes", path, 0),
    time: time === undefined ? current.time : add(current.time, parseFraction(time, path)),
  };
}

export function readRelativeConnector(
  element: Element,
  current: ConnectorLocation,
  expectedType: RelativeConnector["type"],
  path: string,
): RelativeConnector;
export function readRelativeConnector(
  element: Element,
  current: ConnectorLocation,
  expectedType: RelativeConnector["type"],
  path: string,
  policy: ReadPolicy | undefined,
): RelativeConnector | undefined;
export function readRelativeConnector(
  element: Element,
  current: ConnectorLocation,
  expectedType: RelativeConnector["type"],
  path: string,
  policy?: ReadPolicy,
): RelativeConnector | undefined {
  const type = element.getAttribute("type") ?? "";
  if (!type) {
    throw new MuseScoreConversionError("invalid-structure", "connector is missing its type", path);
  }
  let rejected = false;
  const check = (operation: () => void): boolean => {
    const validate = (): boolean => {
      operation();
      return true;
    };
    const supported = policy ? policy.recover(validate) : validate();
    if (!supported) rejected = true;
    return Boolean(supported);
  };
  validateStructure(element, [type, "next", "prev"], [type, "next", "prev"], path);
  const next = child(element, "next");
  const prev = child(element, "prev");
  if ((!next && !prev) || (next && prev)) {
    throw new MuseScoreConversionError("invalid-structure", "connector must have exactly one next or prev", path);
  }
  const direction = next ? "next" : "prev";
  const body = child(element, type);
  if ((direction === "next") !== Boolean(body)) {
    throw new MuseScoreConversionError("invalid-structure", "only the connector start must contain its body", path);
  }
  const link = (next ?? prev)!;
  validateStructure(link, ["location"], ["location"], path);
  const location = child(link, "location");
  if (!location) throw new MuseScoreConversionError("invalid-structure", "connector is missing location", path);
  validateStructure(location, ["staves", "voices", "fractions", "notes", "measures", "grace", "timeTick"], [], path);
  const target = relativeTarget(location, current, path);
  if (![target.staff, target.voice, target.note].every(Number.isSafeInteger)) {
    throw new MuseScoreConversionError("invalid-structure", "connector endpoint exceeds supported range", path);
  }
  const measures = integerText(location, "measures", path, 0);
  const timeTick = integerText(location, "timeTick", path, 0);
  integerText(location, "grace", path, 0);
  if (body) validateBody(body, path);
  const knownAnchor = check(() => {
    if (child(location, "grace")) unsupported("grace connector locations are not supported", path);
    if (measures !== 0 || timeTick !== 0) {
      unsupported("measure and time-tick connector locations are not supported", path);
    }
  });
  const partial = body && text(body, "partialSpannerDirection");
  const connector: RelativeConnector = {
    type: expectedType,
    direction,
    current,
    target,
    body,
    path,
    ...(rejected ? { rejected } : {}),
    ...(!knownAnchor ? { unresolvedAnchor: true } : {}),
    ...(partial !== undefined && ["incoming", "outgoing", "both"].includes(partial) ? { partial: true } : {}),
  };
  if (type !== expectedType) {
    validateRecoveredTiming(connector);
    if (!CONNECTOR_TYPES.includes(type)) {
      throw new MuseScoreConversionError("invalid-structure", `unknown Spanner type "${type}"`, path);
    }
    const message = `Spanner type "${type}" is not supported here`;
    if (!policy) unsupported(message, path);
    policy.skip(message, path, formatFraction(current.time));
    return undefined;
  }
  return connector;
}

function validateConnectorTiming(endpoint: RelativeConnector): void {
  const duration =
    endpoint.direction === "next"
      ? subtract(endpoint.target.time, endpoint.current.time)
      : subtract(endpoint.current.time, endpoint.target.time);
  if (compare(duration, ZERO) <= 0) {
    throw new MuseScoreConversionError(
      "invalid-timing",
      "connector end must be strictly later than its start",
      endpoint.path,
    );
  }
  const ticks = endpoint.body && text(endpoint.body, "ticks_f");
  if (ticks !== undefined && compare(parseFraction(ticks, endpoint.path), duration) !== 0) {
    throw new MuseScoreConversionError(
      "invalid-timing",
      "connector ticks_f disagrees with its endpoint onset delta",
      endpoint.path,
    );
  }
}

function outsideSelection(location: ConnectorLocation, length: Fraction, staffCount: number, path: string): boolean {
  if (![location.staff, location.voice, location.note].every(Number.isSafeInteger)) {
    throw new MuseScoreConversionError("invalid-structure", "connector endpoint exceeds supported range", path);
  }
  return (
    location.staff < 0 ||
    location.staff >= staffCount ||
    location.voice < 0 ||
    location.voice > 3 ||
    location.note < 0 ||
    compare(location.time, ZERO) < 0 ||
    compare(location.time, length) > 0
  );
}

function validateRecoveredTiming(endpoint: RelativeConnector, match?: RelativeConnector): void {
  const reciprocal = match && connectorLocationKey(match.target) === connectorLocationKey(endpoint.current);
  const unresolvedPair = reciprocal && (match.partial || match.unresolvedAnchor);
  if (!endpoint.unresolvedAnchor && !endpoint.partial && !unresolvedPair) {
    validateConnectorTiming(endpoint);
  }
}

export function pairRelativeConnectors<T extends RelativeConnector>(
  endpoints: readonly T[],
  length: Fraction,
  staffCount: number,
  policy?: ReadPolicy,
): { start: T; end: T }[] {
  const index = new Map<string, T>();
  const rejected = new Set<T>();
  const incomplete = (message: string, endpoint: T): void => {
    if (!policy?.skipUnsupported) {
      throw new MuseScoreConversionError("invalid-structure", message, endpoint.path);
    }
    policy.skip(message, endpoint.path, formatFraction(endpoint.current.time));
    rejected.add(endpoint);
  };
  const key = (endpoint: RelativeConnector, reverse = false): string => {
    const direction = reverse ? (endpoint.direction === "next" ? "prev" : "next") : endpoint.direction;
    const current = connectorLocationKey(reverse ? endpoint.target : endpoint.current);
    const target = connectorLocationKey(reverse ? endpoint.current : endpoint.target);
    // Distinct slurs may share either endpoint; ties and hairpins remain one-to-one.
    return `${endpoint.type}:${direction}:${current}${endpoint.type === "Slur" ? `:${target}` : ""}`;
  };
  for (const endpoint of endpoints) {
    if (endpoint.rejected) rejected.add(endpoint);
    if (policy?.skipUnsupported && endpoint.partial && !endpoint.rejected) {
      policy.skip(
        `partial ${endpoint.type} connectors are not supported`,
        endpoint.path,
        formatFraction(endpoint.current.time),
      );
      rejected.add(endpoint);
    }
    for (const location of [endpoint.current, endpoint.target]) {
      if (outsideSelection(location, length, staffCount, endpoint.path)) {
        incomplete("connector endpoint is outside the copied selection", endpoint);
      }
      if (endpoint.type === "HairPin" && location.note !== 0) {
        if (!policy) unsupported("HairPin cannot have a note-index anchor", endpoint.path);
        policy.skip("HairPin cannot have a note-index anchor", endpoint.path, formatFraction(endpoint.current.time));
        rejected.add(endpoint);
      }
    }
    // Unsupported anchor coordinates must not alias ordinary note/event coordinates.
    if (endpoint.unresolvedAnchor) continue;
    if (index.has(key(endpoint))) {
      throw new MuseScoreConversionError("invalid-structure", "ambiguous duplicate connector endpoint", endpoint.path);
    }
    index.set(key(endpoint), endpoint);
  }
  const pairs: { start: T; end: T }[] = [];
  for (const endpoint of endpoints) {
    const match = index.get(key(endpoint, true));
    if (policy?.skipUnsupported) validateRecoveredTiming(endpoint, match);
    if (rejected.has(endpoint) || endpoint.unresolvedAnchor) continue;
    if (!match || connectorLocationKey(match.target) !== connectorLocationKey(endpoint.current)) {
      incomplete("orphan or non-reciprocal connector endpoint", endpoint);
      continue;
    }
    if (rejected.has(match)) continue;
    if (endpoint.direction === "prev") continue;
    validateConnectorTiming(endpoint);
    pairs.push({ start: endpoint, end: match });
  }
  return pairs;
}

function relativeLocationXml(from: ConnectorLocation, to: ConnectorLocation): string {
  const time = subtract(to.time, from.time);
  const fields = [
    from.staff === to.staff ? "" : `<staves>${to.staff - from.staff}</staves>`,
    from.voice === to.voice ? "" : `<voices>${to.voice - from.voice}</voices>`,
    isZero(time) ? "" : `<fractions>${formatFraction(time)}</fractions>`,
    from.note === to.note ? "" : `<notes>${to.note - from.note}</notes>`,
  ].join("");
  return `<location>${fields}</location>`;
}

export function connectorPairXml(
  type: "Tie" | "HairPin",
  start: ConnectorLocation,
  end: ConnectorLocation,
  properties = "",
): { start: string; end: string } {
  const duration = subtract(end.time, start.time);
  if (compare(duration, ZERO) <= 0) {
    throw new MuseScoreConversionError("invalid-timing", "connector end must be strictly later than its start");
  }
  return {
    start:
      `<Spanner type="${type}"><${type}>${properties}<ticks_f>${formatFraction(duration)}</ticks_f></${type}>` +
      `<next>${relativeLocationXml(start, end)}</next></Spanner>`,
    end: `<Spanner type="${type}"><prev>${relativeLocationXml(end, start)}</prev></Spanner>`,
  };
}
