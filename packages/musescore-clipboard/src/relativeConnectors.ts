import type { Element } from "@xmldom/xmldom";
import { MuseScoreConversionError, unsupported } from "./errors";
import { ZERO, add, compare, formatFraction, isZero, parseFraction, subtract, type Fraction } from "./fractions";
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
}

export function connectorChildren(element: Element, allowed: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const item of children(element)) {
    if (!allowed.includes(item.tagName)) unsupported(`connector property "${item.tagName}" is not supported`, path);
    if (seen.has(item.tagName)) {
      throw new MuseScoreConversionError("invalid-structure", `duplicate connector ${item.tagName}`, path);
    }
    if (!["Tie", "HairPin", "Slur", "next", "prev", "location"].includes(item.tagName)) {
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

export function connectorLocationKey(location: ConnectorLocation): string {
  return `${location.staff}:${location.voice}:${formatFraction(location.time)}:${location.note}`;
}

function relativeTarget(element: Element, current: ConnectorLocation, path: string): ConnectorLocation {
  connectorChildren(element, ["staves", "voices", "fractions", "notes", "measures", "grace", "timeTick"], path);
  if (child(element, "grace")) unsupported("grace connector locations are not supported", path);
  if (integerText(element, "measures", path, 0) !== 0 || integerText(element, "timeTick", path, 0) !== 0) {
    unsupported("measure and time-tick connector locations are not supported", path);
  }
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
): RelativeConnector {
  const type = element.getAttribute("type");
  if (type !== expectedType) unsupported(`Spanner type "${type ?? ""}" is not supported here`, path);
  connectorChildren(element, [type, "next", "prev"], path);
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
  connectorChildren(link, ["location"], path);
  const location = child(link, "location");
  if (!location) throw new MuseScoreConversionError("invalid-structure", "connector is missing location", path);
  return { type, direction, current, target: relativeTarget(location, current, path), body, path };
}

export function pairRelativeConnectors<T extends RelativeConnector>(
  endpoints: readonly T[],
  length: Fraction,
  staffCount: number,
): { start: T; end: T }[] {
  const index = new Map<string, T>();
  const key = (endpoint: RelativeConnector, reverse = false): string => {
    const direction = reverse ? (endpoint.direction === "next" ? "prev" : "next") : endpoint.direction;
    const current = connectorLocationKey(reverse ? endpoint.target : endpoint.current);
    const target = connectorLocationKey(reverse ? endpoint.current : endpoint.target);
    // Distinct slurs may share either endpoint; ties and hairpins remain one-to-one.
    return `${endpoint.type}:${direction}:${current}${endpoint.type === "Slur" ? `:${target}` : ""}`;
  };
  for (const endpoint of endpoints) {
    for (const location of [endpoint.current, endpoint.target]) {
      if (
        !Number.isSafeInteger(location.staff) ||
        location.staff < 0 ||
        location.staff >= staffCount ||
        !Number.isSafeInteger(location.voice) ||
        location.voice < 0 ||
        location.voice > 3 ||
        !Number.isSafeInteger(location.note) ||
        location.note < 0 ||
        compare(location.time, ZERO) < 0 ||
        compare(location.time, length) > 0
      ) {
        throw new MuseScoreConversionError(
          "invalid-structure",
          "connector endpoint is outside the copied selection",
          endpoint.path,
        );
      }
      if (endpoint.type === "HairPin" && location.note !== 0) {
        unsupported("HairPin cannot have a note-index anchor", endpoint.path);
      }
    }
    if (index.has(key(endpoint))) {
      throw new MuseScoreConversionError("invalid-structure", "ambiguous duplicate connector endpoint", endpoint.path);
    }
    index.set(key(endpoint), endpoint);
  }
  const pairs: { start: T; end: T }[] = [];
  for (const endpoint of endpoints) {
    const match = index.get(key(endpoint, true));
    if (!match || connectorLocationKey(match.target) !== connectorLocationKey(endpoint.current)) {
      throw new MuseScoreConversionError(
        "invalid-structure",
        "orphan or non-reciprocal connector endpoint",
        endpoint.path,
      );
    }
    if (endpoint.direction === "prev") continue;
    const duration = subtract(match.current.time, endpoint.current.time);
    if (compare(duration, ZERO) <= 0) {
      throw new MuseScoreConversionError(
        "invalid-timing",
        "connector end must be strictly later than its start",
        endpoint.path,
      );
    }
    const ticks = text(endpoint.body!, "ticks_f");
    if (ticks !== undefined && compare(parseFraction(ticks, endpoint.path), duration) !== 0) {
      throw new MuseScoreConversionError(
        "invalid-timing",
        "connector ticks_f disagrees with its endpoint onset delta",
        endpoint.path,
      );
    }
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
