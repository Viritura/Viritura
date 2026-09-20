import type { NoteEvent, Slur } from "@viritura/core";
import type { Element } from "@xmldom/xmldom";
import { unsupported } from "./errors";
import type { Fraction } from "./fractions";
import type { ReadPolicy } from "./readPolicy";
import {
  connectorChildren,
  pairRelativeConnectors,
  readRelativeConnector,
  type ConnectorLocation,
  type RelativeConnector,
} from "./relativeConnectors";
import { children, integerText, text } from "./xml";

export interface SlurConnector extends RelativeConnector {
  event: NoteEvent;
  properties: Omit<Slur, "target">;
}

function slurProperties(body: Element, path: string): Omit<Slur, "target"> {
  // SlurSegment is emitted for user-modified appearance, not required endpoint data.
  connectorChildren(body, ["ticks_f", "up", "lineType", "partialSpannerDirection"], path);
  const partial = text(body, "partialSpannerDirection");
  if (partial !== undefined && partial !== "none") {
    unsupported(`partial Slur direction "${partial}" is not supported`, path);
  }
  const properties: Omit<Slur, "target"> = {};
  const side = text(body, "up");
  if (side === "up" || side === "down") {
    properties.side = side;
    properties.sideEnd = side;
  } else if (side !== undefined && side !== "auto") {
    unsupported(`Slur direction "${side}" is not supported`, path);
  }
  if (text(body, "lineType") !== undefined) {
    const lineType = integerText(body, "lineType", path);
    switch (lineType) {
      case 0:
        properties.lineType = "solid";
        break;
      case 1:
        properties.lineType = "dotted";
        break;
      case 2:
        properties.lineType = "dashed";
        break;
      default:
        unsupported(`Slur lineType "${lineType}" is not supported`, path);
    }
  }
  return properties;
}

export function readSlurConnectors(
  element: Element,
  event: NoteEvent,
  location: ConnectorLocation,
  grace: boolean,
  path: string,
  policy?: ReadPolicy,
): SlurConnector[] {
  return children(element, "Spanner").flatMap((spanner, index) => {
    const connectorPath = `${path}/Spanner[${index}]`;
    const connector = readRelativeConnector(spanner, location, "Slur", connectorPath, policy);
    if (!connector) return [];
    const readProperties = (): Omit<Slur, "target"> => {
      const properties = connector.body ? slurProperties(connector.body, connectorPath) : {};
      if (grace) unsupported("slurs involving grace notes are not supported", connectorPath);
      // Both source anchors are ChordRest, so their relative note-index delta must be zero.
      if (connector.target.note !== 0) unsupported("Slur cannot have a note-index anchor", connectorPath);
      return properties;
    };
    const properties = policy ? policy.recover(readProperties) : readProperties();
    return [
      {
        ...connector,
        ...(!properties ? { rejected: true } : {}),
        ...(grace ? { unresolvedAnchor: true } : {}),
        event,
        properties: properties ?? {},
      },
    ];
  });
}

export function resolveSlurConnectors(
  endpoints: readonly SlurConnector[],
  length: Fraction,
  staffCount: number,
  policy?: ReadPolicy,
): void {
  for (const { start, end } of pairRelativeConnectors(endpoints, length, staffCount, policy)) {
    (start.event.slurs ??= []).push({ target: end.event.id!, ...start.properties });
  }
}
