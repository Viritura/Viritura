import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TARGET } from "./recording";

const REPORTS = join(TARGET, "reports");
const FILES = "files";
const CROP_MARGIN = 8;
const MOST_OPEN_SECTIONS = 20;

export interface ReportSection {
  name: string;
  mnx: string;
  images: ReportImage[];
}

export interface ReportImage {
  label: string;
  /** Missing when this side didn't draw the page. */
  svg: string | undefined;
}

/** Writes an HTML page showing each section's MNX and drawings, and returns its path. */
export function writeReport(name: string, title: string, sections: ReportSection[]): string {
  mkdirSync(join(REPORTS, FILES), { recursive: true });
  const html = join(REPORTS, `${name}.html`);
  writeFileSync(html, htmlPage(title, sections));
  return html;
}

function htmlPage(title: string, sections: ReportSection[]): string {
  const open = sections.length <= MOST_OPEN_SECTIONS;
  return `<!doctype html>
<meta charset="utf-8">
<title>${escape(title)}</title>
<style>
  body { font: 15px system-ui; margin: 2rem auto; max-width: 1100px; padding: 0 1rem; }
  summary { cursor: pointer; font-family: ui-monospace, monospace; padding: 0.4rem 0; word-break: break-all; }
  iframe { border: 1px solid #ccc; height: 14rem; resize: vertical; width: 100%; }
  img { border: 1px solid #ccc; display: block; margin: 0.25rem 0 1rem; max-width: 100%; width: 100%; }
</style>
<h1>${escape(title)}</h1>
<p>Drawings: ${sections.length}</p>
${sections.map((section) => htmlSection(section, open)).join("\n")}
<script>
  for (const section of document.querySelectorAll("details")) {
    const template = section.querySelector("template");
    const load = () => template.replaceWith(template.content);
    if (section.open) load();
    else section.addEventListener("toggle", load, { once: true });
  }
</script>
`;
}

// Each section's content waits in a <template> until it's opened, so that large reports load quickly.
function htmlSection({ name, mnx, images }: ReportSection, open: boolean): string {
  return `<details${open ? " open" : ""}>
<summary>${escape(name)}</summary>
<template>
MNX<iframe loading="lazy" src="${publishMnx(mnx)}"></iframe>
${images.map(htmlImage).join("\n")}
</template>
</details>`;
}

function htmlImage({ label, svg }: ReportImage): string {
  return svg ? `${label}<img loading="lazy" src="${publishSvg(svg)}">` : `<p>${label}: not drawn</p>`;
}

const publishSvg = once((file) => publish(file, ".svg", crop));
const publishMnx = once((file) => publish(file, ".mnx.txt", (mnx) => formatJson(JSON.parse(mnx))));

function once(publisher: (file: string) => string): (file: string) => string {
  const published = new Map<string, string>();
  return (file) => {
    const name = published.get(file) ?? publisher(file);
    published.set(file, name);
    return name;
  };
}

// Named by content, so that reports share what they have in common.
function publish(file: string, extension: string, transform: (content: string) => string): string {
  const content = transform(readFileSync(file, "utf8"));
  const hash = createHash("sha256").update(content).digest("hex");
  const name = `${FILES}/${hash.slice(0, 16)}${extension}`;
  const path = join(REPORTS, name);
  if (!existsSync(path)) writeFileSync(path, content);
  return name;
}

// The engine draws each page at full height, so most of a short test's drawing is empty.
function crop(svg: string): string {
  const drawing = svg.slice(svg.indexOf(">"));
  const ys = [
    ...drawing.matchAll(/[MLCQ "]-?[\d.]+[ ,](-?[\d.]+)(?=[ MLCQZ"])/g),
    ...drawing.matchAll(/ c?y[12]?="(-?[\d.]+)"/g),
  ].map(([, y]) => Number(y));
  const top = ys.reduce((a, b) => Math.min(a, b), Infinity) - CROP_MARGIN;
  const bottom = ys.reduce((a, b) => Math.max(a, b), -Infinity) + CROP_MARGIN;
  if (!Number.isFinite(top)) return svg;
  return svg.replace(
    /width="([\d.]+)mm" height="[\d.]+mm" viewBox="[^"]*"/,
    (_, width: string) => `width="${width}mm" height="${bottom - top}mm" viewBox="0 ${top} ${width} ${bottom - top}"`,
  );
}

function formatJson(value: unknown, indent = ""): string {
  const flat = JSON.stringify(value);
  if (flat.length + indent.length <= 100 || typeof value !== "object" || value === null) {
    return flat;
  }
  const inner = `${indent}  `;
  const [open, close] = Array.isArray(value) ? "[]" : "{}";
  const items = Object.entries(value).map(([key, item]) => {
    const prefix = Array.isArray(value) ? "" : `${JSON.stringify(key)}: `;
    return `${inner}${prefix}${formatJson(item, inner)}`;
  });
  return `${open}\n${items.join(",\n")}\n${indent}${close}`;
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}
