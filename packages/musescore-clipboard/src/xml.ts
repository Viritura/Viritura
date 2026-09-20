import { DOMParser, onWarningStopParsing, type Document, type Element } from "@xmldom/xmldom";
import { MuseScoreConversionError } from "./errors";

const MAX_MUSESCORE_XML_BYTES = 8 * 1024 * 1024;
const MAX_XML_NODES = 100_000;
const MAX_XML_DEPTH = 64;

function isXmlCharacter(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

export function validateXmlCharacters(xml: string): void {
  for (const character of xml) {
    if (!isXmlCharacter(character.codePointAt(0)!)) {
      throw new MuseScoreConversionError("malformed-xml", "XML contains an illegal XML 1.0 character");
    }
  }

  // xmldom can decode illegal character references without a warning. Check the
  // source, skipping regions where XML does not expand references.
  const tokens = /<!--|<!\[CDATA\[|<\?|&#/g;
  const reference = /(?:x[0-9a-fA-F]+|[0-9]+);/y;
  for (let token = tokens.exec(xml); token; token = tokens.exec(xml)) {
    if (token[0] !== "&#") {
      const terminator = token[0] === "<!--" ? "-->" : token[0] === "<?" ? "?>" : "]]>";
      const end = xml.indexOf(terminator, tokens.lastIndex);
      if (end < 0) return; // The XML parser diagnoses unterminated literal regions.
      tokens.lastIndex = end + terminator.length;
      continue;
    }
    reference.lastIndex = tokens.lastIndex;
    const value = reference.exec(xml)?.[0];
    if (!value) {
      throw new MuseScoreConversionError("malformed-xml", "XML contains a malformed numeric character reference");
    }
    const hexadecimal = value.startsWith("x");
    const codePoint = Number.parseInt(value.slice(hexadecimal ? 1 : 0, -1), hexadecimal ? 16 : 10);
    if (!isXmlCharacter(codePoint)) {
      throw new MuseScoreConversionError("malformed-xml", "XML character reference is not a legal XML 1.0 character");
    }
    tokens.lastIndex = reference.lastIndex;
  }
}

export function parseSafeXml(xml: string): Document & { documentElement: Element } {
  if (new TextEncoder().encode(xml).byteLength > MAX_MUSESCORE_XML_BYTES) {
    throw new MuseScoreConversionError("unsafe-xml", "payload exceeds 8 MiB");
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new MuseScoreConversionError("unsafe-xml", "DTD and entity declarations are not allowed");
  }
  validateXmlCharacters(xml);
  let document: Document;
  try {
    document = new DOMParser({ onError: onWarningStopParsing }).parseFromString(xml, "application/xml");
  } catch {
    throw new MuseScoreConversionError("malformed-xml", "XML is malformed");
  }
  if (!document.documentElement || document.getElementsByTagName("parsererror").length) {
    throw new MuseScoreConversionError("malformed-xml", "XML is malformed");
  }
  let nodes = 0;
  const visit = (element: Element, depth: number): void => {
    nodes++;
    if (nodes > MAX_XML_NODES || depth > MAX_XML_DEPTH) {
      throw new MuseScoreConversionError("unsafe-xml", "XML structure exceeds safety limits");
    }
    for (const child of children(element)) visit(child, depth + 1);
  };
  visit(document.documentElement, 1);
  return document as Document & { documentElement: Element };
}

export function children(parent: Element, tagName?: string): Element[] {
  return Array.from(parent.children).filter((child) => tagName === undefined || child.tagName === tagName);
}

export function child(parent: Element, tagName: string): Element | undefined {
  return children(parent, tagName)[0];
}

export function text(parent: Element, tagName: string): string | undefined {
  return child(parent, tagName)?.textContent?.trim();
}

export function requiredText(parent: Element, tagName: string, path: string): string {
  const value = text(parent, tagName);
  if (value === undefined || value === "") {
    throw new MuseScoreConversionError("invalid-structure", `missing ${tagName}`, path);
  }
  return value;
}

export function integerText(parent: Element, tagName: string, path: string, fallback?: number): number {
  const value = text(parent, tagName);
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined || !/^-?\d+$/.test(value)) {
    throw new MuseScoreConversionError("invalid-structure", `invalid ${tagName}`, path);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new MuseScoreConversionError("invalid-structure", `${tagName} exceeds supported range`, path);
  }
  return parsed;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
