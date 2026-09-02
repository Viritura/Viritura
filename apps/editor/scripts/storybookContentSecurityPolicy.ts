import { createHash } from "node:crypto";
import { parse } from "parse5";

interface HtmlNode {
  nodeName: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    startTag?: { endOffset: number };
    endTag?: { startOffset: number };
  };
}

function inlineScriptHashes(document: HtmlNode, html: string): string[] {
  const hashes = new Set<string>();

  function visit(node: HtmlNode) {
    const location = node.sourceCodeLocation;
    const hasSource = node.attrs?.some((attribute) => attribute.name === "src") ?? false;
    if (node.nodeName === "script" && !hasSource && location?.startTag && location.endTag) {
      const script = html.slice(location.startTag.endOffset, location.endTag.startOffset);
      if (script.trim()) {
        const digest = createHash("sha256").update(script).digest("base64");
        hashes.add(`'sha256-${digest}'`);
      }
    }
    node.childNodes?.forEach(visit);
  }

  visit(document);
  return [...hashes].sort();
}

function findNode(root: HtmlNode, nodeName: string): HtmlNode | undefined {
  if (root.nodeName === nodeName) return root;
  for (const child of root.childNodes ?? []) {
    const match = findNode(child, nodeName);
    if (match) return match;
  }
  return undefined;
}

function findNodes(root: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode[] {
  const matches = predicate(root) ? [root] : [];
  for (const child of root.childNodes ?? []) matches.push(...findNodes(child, predicate));
  return matches;
}

function removeExistingPolicy(document: HtmlNode, html: string): string {
  const policies = findNodes(
    document,
    (node) =>
      node.nodeName === "meta" &&
      node.attrs?.some(
        (attribute) => attribute.name === "http-equiv" && attribute.value.toLowerCase() === "content-security-policy",
      ) === true,
  );
  return policies
    .map((node) => node.sourceCodeLocation)
    .filter((location) => location !== undefined)
    .sort((left, right) => right.startOffset - left.startOffset)
    .reduce((output, location) => {
      const leadingWhitespace = output.slice(0, location.startOffset).match(/\r?\n[\t ]*$/)?.[0] ?? "";
      const startOffset = location.startOffset - leadingWhitespace.length;
      return `${output.slice(0, startOffset)}${output.slice(location.endOffset)}`;
    }, html);
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function applyContentSecurityPolicy(html: string, title?: string): string {
  let document = parse(html, { sourceCodeLocationInfo: true }) as unknown as HtmlNode;

  if (title) {
    const titleNode = findNode(document, "title")?.sourceCodeLocation;
    if (!titleNode?.startTag || !titleNode.endTag) throw new Error("Storybook manager HTML has no title element.");
    html = `${html.slice(0, titleNode.startTag.endOffset)}${title}${html.slice(titleNode.endTag.startOffset)}`;
    document = parse(html, { sourceCodeLocationInfo: true }) as unknown as HtmlNode;
  }

  html = removeExistingPolicy(document, html);
  document = parse(html, { sourceCodeLocationInfo: true }) as unknown as HtmlNode;
  const head = findNode(document, "head")?.sourceCodeLocation?.startTag;
  if (!head) throw new Error("Storybook HTML has no source-located head element.");

  const scriptHashes = inlineScriptHashes(document, html);
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${scriptHashes.join(" ")}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self' blob: https://assets.viritura.com",
    "connect-src 'self' https://api.viritura.com https://assets.viritura.com",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  const meta = `<meta http-equiv="content-security-policy" content="${escapeAttribute(policy)}">`;
  return `${html.slice(0, head.endOffset)}\n    ${meta}${html.slice(head.endOffset)}`;
}
