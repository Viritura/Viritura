import type {
  CoverageAudit,
  CoverageRow,
  CoverageSummary,
  PartialKind,
  PartialReason,
  SupportStatus,
} from "./coverageModel";
import { summarizeStatuses } from "./coverageModel";

const EXPECTED_ROW_COUNT = 852;
const EXPECTED_GROUPS = [
  "Notes",
  "Rhythms",
  "Rests",
  "Measures",
  "Voices and layers",
  "Structure",
  "Instruments",
  "Metadata",
  "Lyrics",
  "Chord symbols",
  "Tablature",
] as const;

function decodeMarkdownText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\\"/g, '"')
    .replace(/\\\|/g, "|")
    .trim();
}

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

function parseStatus(value: string, rowId: string): SupportStatus {
  if (value === "S" || value === "P" || value === "N" || value === "NA" || value === "?") return value;
  throw new Error(`Unknown support status "${value}" on notationref row "${rowId}".`);
}

const PARTIAL_KINDS = new Set<PartialKind>([
  "Subset",
  "Approximation",
  "Lossy",
  "Extension required",
  "Fixed style",
  "Semantic gap",
]);

function parsePartialReason(notes: string, surface: "Viritura MNX" | "Viritura MXL"): PartialReason | undefined {
  const nextSurface = surface === "Viritura MNX" ? "; Viritura MXL [" : "; Viritura MNX [";
  const start = `${surface} [`;
  const startIndex = notes.indexOf(start);
  if (startIndex < 0) return undefined;
  const kindEnd = notes.indexOf("]: ", startIndex + start.length);
  if (kindEnd < 0) throw new Error(`Malformed partial reason: ${notes}`);
  const kind = notes.slice(startIndex + start.length, kindEnd);
  if (!PARTIAL_KINDS.has(kind as PartialKind)) throw new Error(`Unknown partial-reason kind "${kind}".`);
  const textStart = kindEnd + 3;
  const nextIndex = notes.indexOf(nextSurface, textStart);
  return {
    kind: kind as PartialKind,
    text: notes.slice(textStart, nextIndex < 0 ? undefined : nextIndex).trim(),
  };
}

function parseFindings(lines: readonly string[]): readonly string[] {
  const findings: string[] = [];
  let inSection = false;
  let current = "";
  const flush = () => {
    if (current) findings.push(decodeMarkdownText(current));
    current = "";
  };
  for (const line of lines) {
    if (line === "### Highest-confidence findings") {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) break;
    if (!inSection) continue;
    if (line.startsWith("- ")) {
      flush();
      current = line.slice(2);
    } else if (current && line.trim()) {
      current += ` ${line.trim()}`;
    }
  }
  flush();
  if (findings.length === 0) throw new Error("Coverage audit has no highest-confidence findings.");
  return findings;
}

function parseRows(lines: readonly string[]): readonly CoverageRow[] {
  const rows: CoverageRow[] = [];
  let inSection = false;
  let group = "";
  for (const line of lines) {
    if (line === "## Complete row audit") {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith("### ")) {
      group = line.slice(4).trim();
      continue;
    }
    if (!line.startsWith("| ") || line.startsWith("| ---") || line.startsWith("| Subgroup")) continue;
    const cells = splitTableRow(line);
    if (cells.length !== 8) throw new Error(`Expected 8 cells in coverage row, found ${cells.length}: ${line}`);
    const id = cells[2]?.replace(/`/g, "");
    if (!group || !id) throw new Error(`Coverage row is missing its group or ID: ${line}`);
    const notes = decodeMarkdownText(cells[7]!);
    rows.push({
      group,
      subgroup: decodeMarkdownText(cells[0]!),
      concept: decodeMarkdownText(cells[1]!),
      id,
      mnx: parseStatus(cells[3]!, id),
      musicXml: parseStatus(cells[4]!, id),
      virituraMnx: parseStatus(cells[5]!, id),
      virituraMxl: parseStatus(cells[6]!, id),
      partialReasons: {
        virituraMnx: parsePartialReason(notes, "Viritura MNX"),
        virituraMxl: parsePartialReason(notes, "Viritura MXL"),
      },
    });
  }
  return rows;
}

function parseSnapshot(lines: readonly string[]): string {
  const snapshotLines = lines.slice(0, 8).filter((line) => line.startsWith("> "));
  if (snapshotLines.length === 0) throw new Error("Coverage audit snapshot metadata is missing.");
  return decodeMarkdownText(snapshotLines.map((line) => line.slice(2)).join(" "));
}

function summaryValues(summary: CoverageSummary): readonly number[] {
  return [summary.supported, summary.partial, summary.unsupported, summary.notApplicable, summary.unknown];
}

function parseDeclaredSummaries(lines: readonly string[]): Readonly<Record<string, readonly number[]>> {
  const summaries: Record<string, readonly number[]> = {};
  for (const line of lines) {
    if (!line.startsWith("| ") || !line.includes(" | ")) continue;
    const cells = splitTableRow(line);
    if (cells.length !== 6 || !cells.slice(1).every((value) => /^\d+$/.test(value))) continue;
    summaries[cells[0]!] = cells.slice(1).map(Number);
  }
  return summaries;
}

function validateAudit(audit: CoverageAudit, declared: Readonly<Record<string, readonly number[]>>): void {
  if (audit.rows.length !== EXPECTED_ROW_COUNT) {
    throw new Error(`Expected ${EXPECTED_ROW_COUNT} notationref rows, found ${audit.rows.length}.`);
  }
  const uniqueIds = new Set(audit.rows.map((row) => row.id));
  if (uniqueIds.size !== audit.rows.length) throw new Error("Coverage audit contains duplicate notationref IDs.");
  if (audit.groups.join("|") !== EXPECTED_GROUPS.join("|")) {
    throw new Error(`Unexpected coverage groups: ${audit.groups.join(", ")}.`);
  }
  const expected: Readonly<Record<string, CoverageSummary>> = {
    "Upstream MNX": audit.summaries.mnx,
    "Upstream MusicXML": audit.summaries.musicXml,
    "Viritura MNX pipeline": audit.summaries.virituraMnx,
    "Viritura MusicXML/MXL importer": audit.summaries.virituraMxl,
  };
  for (const [label, summary] of Object.entries(expected)) {
    const values = declared[label];
    if (!values || values.join("|") !== summaryValues(summary).join("|")) {
      throw new Error(`Coverage summary "${label}" does not match its 852 detail rows.`);
    }
  }
  for (const row of audit.rows) {
    if ((row.virituraMnx === "P" || row.virituraMnx === "?") !== Boolean(row.partialReasons.virituraMnx)) {
      throw new Error(`Viritura MNX partial reason does not match status for "${row.id}".`);
    }
    if ((row.virituraMxl === "P" || row.virituraMxl === "?") !== Boolean(row.partialReasons.virituraMxl)) {
      throw new Error(`Viritura MXL partial reason does not match status for "${row.id}".`);
    }
  }
}

export function parseCoverageMarkdown(markdown: string): CoverageAudit {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const rows = parseRows(lines);
  const groups = [...new Set(rows.map((row) => row.group))];
  const audit: CoverageAudit = {
    snapshot: parseSnapshot(lines),
    findings: parseFindings(lines),
    rows,
    groups,
    summaries: {
      mnx: summarizeStatuses(rows.map((row) => row.mnx)),
      musicXml: summarizeStatuses(rows.map((row) => row.musicXml)),
      virituraMnx: summarizeStatuses(rows.map((row) => row.virituraMnx)),
      virituraMxl: summarizeStatuses(rows.map((row) => row.virituraMxl)),
    },
  };
  validateAudit(audit, parseDeclaredSummaries(lines));
  return audit;
}
