type SupportStatus = "S" | "P" | "N" | "NA" | "?";

interface AuditMetadata {
  taxonomyCommit: string;
  mnxCommit: string;
  musicXmlCommit: string;
  virituraCommit: string;
  upstreamSyncedAt: string;
  virituraAuditedAt: string;
}

export interface AuditRow {
  group: string;
  subgroup: string;
  id: string;
  name: string;
  mnx: SupportStatus;
  musicXml: SupportStatus;
  virituraMnx: SupportStatus;
  virituraMxl: SupportStatus;
  partialGap: string;
}

export interface ConceptNode {
  type: "group" | "subgroup" | "item";
  name: string;
  id?: string;
  items?: ConceptNode[];
}

interface FormatSupport {
  level: number;
  text?: string;
  link?: string;
}

export interface FormatMatrix {
  name: string;
  support: Record<string, FormatSupport>;
}

export interface UpstreamSnapshot {
  metadata: Pick<AuditMetadata, "taxonomyCommit" | "mnxCommit" | "musicXmlCommit">;
  concepts: ConceptNode[];
  mnx: FormatMatrix;
  musicXml: FormatMatrix;
}

interface AuditUpdateReport {
  added: string[];
  removed: string[];
  renamed: string[];
  moved: string[];
  upstreamStatusChanged: string[];
  matrixOnlyIds: {
    mnx: string[];
    musicXml: string[];
  };
  matrixMissingIds: {
    mnx: string[];
    musicXml: string[];
  };
}

interface AuditUpdateResult {
  markdown: string;
  metadata: AuditMetadata;
  rows: AuditRow[];
  report: AuditUpdateReport;
}

const META_PREFIX = "<!-- notationref-audit-meta ";
const META_SUFFIX = " -->";
const ROW_HEADING = "## Complete row audit";
const SUMMARY_HEADING = "## Summary";
const FINDINGS_HEADING = "### Highest-confidence findings";
const SUMMARY_START = "<!-- notationref-audit-summary:start -->";
const SUMMARY_END = "<!-- notationref-audit-summary:end -->";

function splitTableRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of body) {
    if (escaped) {
      current += char === "|" ? "|" : `\\${char}`;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function decode(value: string): string {
  return value
    .replace(/`/g, "")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\\\|/g, "|")
    .replace(/\\([\\`*_[\]{}()#+\-.!])/g, "$1")
    .trim();
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, " ");
}

function parseStatus(value: string, id: string): SupportStatus {
  if (value === "S" || value === "P" || value === "N" || value === "NA" || value === "?") return value;
  throw new Error(`Unknown status "${value}" for notationref row "${id}".`);
}

function parseAuditMetadata(markdown: string): AuditMetadata {
  const line = markdown.split(/\r?\n/).find((candidate) => candidate.startsWith(META_PREFIX));
  if (!line?.endsWith(META_SUFFIX)) {
    throw new Error("Notationref audit metadata marker is missing.");
  }
  const value = JSON.parse(line.slice(META_PREFIX.length, -META_SUFFIX.length)) as Partial<AuditMetadata>;
  const keys: Array<keyof AuditMetadata> = [
    "taxonomyCommit",
    "mnxCommit",
    "musicXmlCommit",
    "virituraCommit",
    "upstreamSyncedAt",
    "virituraAuditedAt",
  ];
  for (const key of keys) {
    if (typeof value[key] !== "string" || value[key] === "") {
      throw new Error(`Notationref audit metadata is missing "${key}".`);
    }
  }
  return value as AuditMetadata;
}

function parseAuditRows(markdown: string): AuditRow[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const rows: AuditRow[] = [];
  let inRows = false;
  let group = "";
  for (const line of lines) {
    if (line === ROW_HEADING) {
      inRows = true;
      continue;
    }
    if (!inRows) continue;
    if (line.startsWith("### ")) {
      group = line.slice(4).trim();
      continue;
    }
    if (!line.startsWith("| ") || line.startsWith("| ---") || line.startsWith("| Subgroup")) continue;
    const cells = splitTableRow(line);
    if (cells.length !== 8) throw new Error(`Malformed notationref audit row: ${line}`);
    const id = decode(cells[2]!);
    rows.push({
      group,
      subgroup: decode(cells[0]!),
      name: decode(cells[1]!),
      id,
      mnx: parseStatus(cells[3]!, id),
      musicXml: parseStatus(cells[4]!, id),
      virituraMnx: parseStatus(cells[5]!, id),
      virituraMxl: parseStatus(cells[6]!, id),
      partialGap: cells[7]!.trim(),
    });
  }
  if (rows.length === 0) throw new Error("Notationref audit contains no detail rows.");
  const ids = new Set(rows.map((row) => row.id));
  if (ids.size !== rows.length) throw new Error("Notationref audit contains duplicate IDs.");
  return rows;
}

export function flattenConcepts(
  nodes: readonly ConceptNode[],
): Array<Pick<AuditRow, "group" | "subgroup" | "id" | "name">> {
  const result: Array<Pick<AuditRow, "group" | "subgroup" | "id" | "name">> = [];
  const walk = (node: ConceptNode, group: string, path: string[]): void => {
    if (node.type === "group") {
      group = node.name;
      path = [node.name];
    } else if (node.type === "subgroup") {
      path = [...path, node.name];
    } else {
      if (!node.id || !group) throw new Error(`Notationref item "${node.name}" is missing its ID or group.`);
      result.push({
        group,
        subgroup: path.slice(1).join(" > "),
        id: node.id,
        name: node.name,
      });
    }
    for (const child of node.items ?? []) walk(child, group, path);
  };
  for (const node of nodes) walk(node, "", []);
  return result;
}

function upstreamStatus(matrix: FormatMatrix, id: string): SupportStatus {
  const level = matrix.support[id]?.level;
  if (level === 1) return "S";
  if (level === 2) return "P";
  if (level === 3) return "N";
  return "?";
}

function reviewGap(surface: "Viritura MNX" | "Viritura MXL"): string {
  return `${surface} [Semantic gap]: Needs source audit for newly added notationref concept`;
}

export function mergeAuditRows(
  currentRows: readonly AuditRow[],
  snapshot: UpstreamSnapshot,
): { rows: AuditRow[]; report: AuditUpdateReport } {
  const concepts = flattenConcepts(snapshot.concepts);
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const conceptIds = new Set(concepts.map((concept) => concept.id));
  const report: AuditUpdateReport = {
    added: [],
    removed: currentRows.filter((row) => !conceptIds.has(row.id)).map((row) => row.id),
    renamed: [],
    moved: [],
    upstreamStatusChanged: [],
    matrixOnlyIds: {
      mnx: Object.keys(snapshot.mnx.support)
        .filter((id) => !conceptIds.has(id))
        .sort(),
      musicXml: Object.keys(snapshot.musicXml.support)
        .filter((id) => !conceptIds.has(id))
        .sort(),
    },
    matrixMissingIds: {
      mnx: concepts.filter((concept) => snapshot.mnx.support[concept.id] === undefined).map((concept) => concept.id),
      musicXml: concepts
        .filter((concept) => snapshot.musicXml.support[concept.id] === undefined)
        .map((concept) => concept.id),
    },
  };

  const rows = concepts.map((concept): AuditRow => {
    const current = currentById.get(concept.id);
    const mnx = upstreamStatus(snapshot.mnx, concept.id);
    const musicXml = upstreamStatus(snapshot.musicXml, concept.id);
    if (!current) {
      report.added.push(concept.id);
      return {
        ...concept,
        mnx,
        musicXml,
        virituraMnx: "?",
        virituraMxl: "?",
        partialGap: `${reviewGap("Viritura MNX")}; ${reviewGap("Viritura MXL")}`,
      };
    }
    if (current.name !== concept.name) report.renamed.push(concept.id);
    if (current.group !== concept.group || current.subgroup !== concept.subgroup) report.moved.push(concept.id);
    if (current.mnx !== mnx || current.musicXml !== musicXml) report.upstreamStatusChanged.push(concept.id);
    return { ...current, ...concept, mnx, musicXml };
  });
  return { rows, report };
}

function countStatuses(
  rows: readonly AuditRow[],
  select: (row: AuditRow) => SupportStatus,
): Record<SupportStatus, number> {
  const counts: Record<SupportStatus, number> = { S: 0, P: 0, N: 0, NA: 0, "?": 0 };
  for (const row of rows) counts[select(row)] += 1;
  return counts;
}

function renderMetadata(metadata: AuditMetadata): string {
  const json = JSON.stringify(metadata);
  return [
    `${META_PREFIX}${json}${META_SUFFIX}`,
    `> Taxonomy: [\`music-notationref@${metadata.taxonomyCommit.slice(0, 7)}\`](https://github.com/w3c-cg/music-notationref/commit/${metadata.taxonomyCommit})`,
    `> · MNX matrix: [\`mnx@${metadata.mnxCommit.slice(0, 7)}\`](https://github.com/w3c-cg/mnx/commit/${metadata.mnxCommit})`,
    `> · MusicXML matrix: [\`musicxml@${metadata.musicXmlCommit.slice(0, 7)}\`](https://github.com/w3c-cg/musicxml/commit/${metadata.musicXmlCommit})`,
    `> · Viritura source: [\`${metadata.virituraCommit.slice(0, 7)}\`](https://github.com/Viritura/Viritura/commit/${metadata.virituraCommit})`,
    `> · Upstream synced ${metadata.upstreamSyncedAt}; Viritura audited ${metadata.virituraAuditedAt}.`,
    "",
    "",
  ].join("\n");
}

function renderSummary(rows: readonly AuditRow[]): string {
  const mnx = countStatuses(rows, (row) => row.mnx);
  const musicXml = countStatuses(rows, (row) => row.musicXml);
  const virituraMnx = countStatuses(rows, (row) => row.virituraMnx);
  const virituraMxl = countStatuses(rows, (row) => row.virituraMxl);
  const lines = [
    SUMMARY_START,
    "| Matrix | S | P | N | NA | ? |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| Upstream MNX | ${mnx.S} | ${mnx.P} | ${mnx.N} | ${mnx.NA} | ${mnx["?"]} |`,
    `| Upstream MusicXML | ${musicXml.S} | ${musicXml.P} | ${musicXml.N} | ${musicXml.NA} | ${musicXml["?"]} |`,
    `| Viritura MNX pipeline | ${virituraMnx.S} | ${virituraMnx.P} | ${virituraMnx.N} | ${virituraMnx.NA} | ${virituraMnx["?"]} |`,
    `| Viritura MusicXML/MXL importer | ${virituraMxl.S} | ${virituraMxl.P} | ${virituraMxl.N} | ${virituraMxl.NA} | ${virituraMxl["?"]} |`,
    "",
    "### Viritura coverage by taxonomy group",
    "",
    "| Group | Rows | MNX pipeline S/P/N/? | MXL import S/P/N/NA/? |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const group of [...new Set(rows.map((row) => row.group))]) {
    const groupRows = rows.filter((row) => row.group === group);
    const groupMnx = countStatuses(groupRows, (row) => row.virituraMnx);
    const groupMxl = countStatuses(groupRows, (row) => row.virituraMxl);
    lines.push(
      `| ${escapeCell(group)} | ${groupRows.length} | ${groupMnx.S}/${groupMnx.P}/${groupMnx.N}/${groupMnx["?"]} | ${groupMxl.S}/${groupMxl.P}/${groupMxl.N}/${groupMxl.NA}/${groupMxl["?"]} |`,
    );
  }
  lines.push(SUMMARY_END, "");
  return lines.join("\n");
}

function renderRows(rows: readonly AuditRow[]): string {
  const lines = [ROW_HEADING, ""];
  for (const group of [...new Set(rows.map((row) => row.group))]) {
    lines.push(
      `### ${group}`,
      "",
      "| Subgroup | Concept | ID | MNX | MusicXML | Viritura MNX | Viritura MXL | Viritura partial gap |",
      "| --- | --- | --- | :---: | :---: | :---: | :---: | --- |",
    );
    for (const row of rows.filter((candidate) => candidate.group === group)) {
      lines.push(
        `| ${escapeCell(row.subgroup)} | ${escapeCell(row.name)} | \`${row.id}\` | ${row.mnx} | ${row.musicXml} | ${row.virituraMnx} | ${row.virituraMxl} | ${row.partialGap} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function replaceMetadata(markdown: string, metadata: AuditMetadata): string {
  const titleEnd = markdown.indexOf("\n\n");
  const introText = "This source-first audit";
  const introTextIndex = markdown.indexOf(introText);
  const methodStart = markdown.indexOf("## Status legend and method");
  if (titleEnd < 0 || introTextIndex < 0 || methodStart < 0) {
    throw new Error("Notationref audit introduction is malformed.");
  }
  const introStart = markdown.lastIndexOf("\n", introTextIndex) + 1;
  const intro = markdown
    .slice(introStart, methodStart)
    .replace(/^> ?/gm, "")
    .replace(/\n\s*\n/g, "\n")
    .trim();
  return `${markdown.slice(0, titleEnd + 2)}${renderMetadata(metadata)}${intro}\n\n${markdown.slice(methodStart)}`;
}

function replaceBetween(markdown: string, start: string, end: string, replacement: string): string {
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Cannot replace audit section "${start}" through "${end}".`);
  return `${markdown.slice(0, startIndex)}${replacement}\n${markdown.slice(endIndex)}`;
}

function replaceSummary(markdown: string, rows: readonly AuditRow[]): string {
  const rendered = renderSummary(rows);
  if (markdown.includes(SUMMARY_START) && markdown.includes(SUMMARY_END)) {
    const endIndex = markdown.indexOf(SUMMARY_END) + SUMMARY_END.length;
    return `${markdown.slice(0, markdown.indexOf(SUMMARY_START))}${rendered}${markdown.slice(endIndex)}`;
  }
  return replaceBetween(markdown, SUMMARY_HEADING, FINDINGS_HEADING, `${SUMMARY_HEADING}\n\n${rendered}\n`);
}

export function updateAuditMarkdown(
  currentMarkdown: string,
  snapshot: UpstreamSnapshot,
  options: { today: string; virituraRevision?: string },
): AuditUpdateResult {
  const normalizedMarkdown = currentMarkdown.replace(/\r\n/g, "\n");
  const currentMetadata = parseAuditMetadata(normalizedMarkdown);
  const currentRows = parseAuditRows(normalizedMarkdown);
  const { rows, report } = mergeAuditRows(currentRows, snapshot);
  const upstreamChanged =
    currentMetadata.taxonomyCommit !== snapshot.metadata.taxonomyCommit ||
    currentMetadata.mnxCommit !== snapshot.metadata.mnxCommit ||
    currentMetadata.musicXmlCommit !== snapshot.metadata.musicXmlCommit;
  const metadata: AuditMetadata = {
    ...currentMetadata,
    ...snapshot.metadata,
    upstreamSyncedAt: upstreamChanged ? options.today : currentMetadata.upstreamSyncedAt,
    ...(options.virituraRevision ? { virituraCommit: options.virituraRevision, virituraAuditedAt: options.today } : {}),
  };
  let markdown = replaceMetadata(normalizedMarkdown, metadata);
  markdown = replaceSummary(markdown, rows);
  const rowStart = markdown.indexOf(ROW_HEADING);
  if (rowStart < 0) throw new Error(`Cannot find "${ROW_HEADING}".`);
  markdown = `${markdown.slice(0, rowStart)}${renderRows(rows)}`;
  return { markdown, metadata, rows, report };
}
