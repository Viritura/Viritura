import { DOMImplementation, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";

export type XmlElement = Element;
export interface XmlContext {
  document: Document;
}
export type XmlAttributes = Readonly<Record<string, string | number | undefined>>;

function xmlText(value: string | number): string {
  const text = String(value);
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("MusicXML cannot contain a non-finite number.");
  // eslint-disable-next-line no-control-regex -- XML 1.0 cannot represent these control characters.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(text) || !text.isWellFormed()) {
    throw new Error("Score text contains characters that XML cannot represent.");
  }
  return text;
}

function musicXmlColor(value: string | number): string {
  let hex = String(value).toUpperCase();
  if (/^#[\dA-F]{3,4}$/u.test(hex)) hex = `#${[...hex.slice(1)].map((digit) => digit + digit).join("")}`;
  if (!/^#[\dA-F]{6}(?:[\dA-F]{2})?$/u.test(hex))
    throw new Error("MusicXML export requires hexadecimal RGB or RGBA score colors.");
  return hex.length === 9 ? `#${hex.slice(7)}${hex.slice(1, 7)}` : hex;
}

export function node(
  context: XmlContext,
  name: string,
  content?: string | number | readonly (XmlElement | undefined)[],
  attributes: XmlAttributes = {},
): XmlElement {
  const element = context.document.createElement(name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) element.setAttribute(key, key === "color" ? musicXmlColor(value) : xmlText(value));
  }
  if (typeof content === "string" || typeof content === "number") {
    element.appendChild(context.document.createTextNode(xmlText(content)));
  } else {
    for (const child of content ?? []) if (child) element.appendChild(child);
  }
  return element;
}

export function createXml(): XmlContext {
  return { document: new DOMImplementation().createDocument(null, "score-partwise", null) };
}

export function serializeXml(context: XmlContext, root: XmlElement): string {
  const oldRoot = context.document.documentElement;
  if (!oldRoot) throw new Error("MusicXML document has no root element.");
  context.document.replaceChild(root, oldRoot);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(context.document)}\n`;
}

export function placement(value: string | undefined): string | undefined {
  if (value === "up") return "above";
  if (value === "down") return "below";
  return value === "above" || value === "below" ? value : undefined;
}
