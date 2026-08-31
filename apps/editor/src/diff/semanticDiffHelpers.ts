/**
 * Shared types and small formatting helpers for the semantic-diff tree.
 * Extracted from semanticDiff.ts to keep that file under the file-size cap.
 */

// ─── Diff tree types ────────────────────────────────────────────

export type DiffType = "unchanged" | "modified" | "added" | "removed";

export interface DiffNode {
  /** JSON path, e.g. "parts[0].measures[2].sequences[0].content[3]" */
  path: string;
  /** Human-readable label, e.g. "Piano → Measure 3 → Voice 1 → Note 4" */
  label: string;
  /** Change type */
  type: DiffType;
  /** Human-readable summary, e.g. "Pitch E4 → C5" */
  summary: string;
  /** Nested changes (omitted when empty) */
  children?: DiffNode[];
  /** JSON snippet of the original subtree */
  beforeJson?: string;
  /** JSON snippet of the modified subtree */
  afterJson?: string;
}

// ─── Raw MNX JSON shapes (lightweight, no dependency on @viritura/core) ──

export interface MnxPitch {
  step: string;
  octave: number;
  alter?: number;
}

export interface MnxNote {
  id?: string;
  pitch: MnxPitch;
  [key: string]: unknown;
}

export interface MnxDuration {
  base: string;
  dots?: number;
}

export interface MnxEvent {
  type?: string;
  id?: string;
  duration?: MnxDuration;
  notes?: MnxNote[];
  rest?: unknown;
  markings?: unknown;
  slurs?: unknown[];
  lyrics?: unknown;
  [key: string]: unknown;
}

export interface MnxSequence {
  content: MnxEvent[];
  staff?: number;
  voice?: string;
  fullMeasure?: unknown;
}

export interface MnxPartMeasure {
  clefs?: unknown[];
  sequences?: MnxSequence[];
  beams?: unknown[];
  dynamics?: unknown[];
  ottavas?: unknown[];
}

export interface MnxPart {
  id?: string;
  name?: string;
  shortName?: string;
  measures: MnxPartMeasure[];
  staves?: number;
}

export interface MnxGlobalMeasure {
  id?: string;
  time?: { count: number; unit: number; display?: string };
  key?: { fifths: number };
  barline?: { type: string };
  tempos?: unknown[];
  repeatStart?: unknown;
  repeatEnd?: unknown;
  ending?: unknown;
  segno?: unknown;
  fine?: unknown;
  jump?: unknown;
}

export interface MnxDocument {
  mnx?: { version: number };
  global?: { measures?: MnxGlobalMeasure[] };
  parts?: MnxPart[];
  layouts?: unknown[];
  scores?: unknown[];
}

// ─── Formatting helpers ─────────────────────────────────────────

export function jsonSnippet(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function stableHash(value: unknown): string {
  return JSON.stringify(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function pitchLabel(p: MnxPitch): string {
  const alter = p.alter === 1 ? "♯" : p.alter === -1 ? "♭" : p.alter === 2 ? "𝄪" : p.alter === -2 ? "𝄫" : "";
  return `${p.step}${alter}${p.octave}`;
}

export function durationLabel(d: MnxDuration): string {
  const dots = d.dots ? "." + ".".repeat(d.dots - 1) : "";
  return `${d.base}${dots}`;
}

function timeSigLabel(ts: { count: number; unit: number }): string {
  return `${ts.count}/${ts.unit}`;
}

function keySigLabel(ks: { fifths: number }): string {
  const names: Record<number, string> = {
    "-7": "C♭ major",
    "-6": "G♭ major",
    "-5": "D♭ major",
    "-4": "A♭ major",
    "-3": "E♭ major",
    "-2": "B♭ major",
    "-1": "F major",
    "0": "C major",
    "1": "G major",
    "2": "D major",
    "3": "A major",
    "4": "E major",
    "5": "B major",
    "6": "F♯ major",
    "7": "C♯ major",
  };
  return names[String(ks.fifths) as unknown as number] ?? `${ks.fifths} fifths`;
}

export function eventLabel(ev: MnxEvent): string {
  if (ev.rest !== undefined) {
    return `rest (${ev.duration ? durationLabel(ev.duration) : "?"})`;
  }
  if (ev.notes && ev.notes.length > 0) {
    if (ev.notes.length === 1 && ev.notes[0]) {
      return `${pitchLabel(ev.notes[0].pitch)} (${ev.duration ? durationLabel(ev.duration) : "?"})`;
    }
    return `chord [${ev.notes.map((n) => pitchLabel(n.pitch)).join(", ")}] (${ev.duration ? durationLabel(ev.duration) : "?"})`;
  }
  return ev.duration ? durationLabel(ev.duration) : "event";
}

export function summarizeGlobalMeasureChange(b: MnxGlobalMeasure, a: MnxGlobalMeasure): string[] {
  const summaryParts: string[] = [];

  if (!deepEqual(b.time, a.time)) {
    const bTime = b.time ? timeSigLabel(b.time) : "none";
    const aTime = a.time ? timeSigLabel(a.time) : "none";
    summaryParts.push(`Time signature: ${bTime} → ${aTime}`);
  }
  if (!deepEqual(b.key, a.key)) {
    const bKey = b.key ? keySigLabel(b.key) : "none";
    const aKey = a.key ? keySigLabel(a.key) : "none";
    summaryParts.push(`Key signature: ${bKey} → ${aKey}`);
  }
  if (!deepEqual(b.barline, a.barline)) {
    summaryParts.push(`Barline: ${b.barline?.type ?? "regular"} → ${a.barline?.type ?? "regular"}`);
  }
  if (!deepEqual(b.tempos, a.tempos)) {
    summaryParts.push("Tempo changed");
  }
  if (!deepEqual(b.repeatStart, a.repeatStart) || !deepEqual(b.repeatEnd, a.repeatEnd)) {
    summaryParts.push("Repeat markings changed");
  }
  if (!deepEqual(b.ending, a.ending)) {
    summaryParts.push("Ending changed");
  }
  if (!deepEqual(b.segno, a.segno) || !deepEqual(b.fine, a.fine) || !deepEqual(b.jump, a.jump)) {
    summaryParts.push("Navigation marks changed");
  }

  if (summaryParts.length === 0) {
    summaryParts.push("Global measure modified");
  }
  return summaryParts;
}
