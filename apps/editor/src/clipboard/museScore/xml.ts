import { MuseScoreConversionError } from "./errors";

const MAX_MUSESCORE_XML_BYTES = 8 * 1024 * 1024;
const MAX_XML_NODES = 100_000;
const MAX_XML_DEPTH = 64;

export function parseSafeXml(xml: string): Document {
  if (new TextEncoder().encode(xml).byteLength > MAX_MUSESCORE_XML_BYTES) {
    throw new MuseScoreConversionError("unsafe-xml", "payload exceeds 8 MiB");
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new MuseScoreConversionError("unsafe-xml", "DTD and entity declarations are not allowed");
  }
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (!document.documentElement || document.querySelector("parsererror")) {
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
  return document;
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
