/**
 * Measure-level MNX diff — compares two MNX JSON documents at the measure level
 * to detect which measures changed, were added, or were removed.
 *
 * Uses LCS-based alignment (from measureAlign.ts) so that inserted or deleted
 * measures don't cause all subsequent measures to appear "modified".
 */

import { alignMeasures } from "./measureAlign";

/** Status of a measure in the diff. */
export type MeasureDiffStatus = "unchanged" | "modified" | "added" | "removed";

/** Result of comparing two MNX documents at the measure level. */
export interface MeasureDiffResult {
  /**
   * Per-part measure statuses keyed by "p{partIdx}/m{measureIdx}".
   * The measure index refers to the position in the alignment sequence.
   */
  measures: Map<string, MeasureDiffStatus>;
  /**
   * Global measure statuses keyed by "global/m{measureIdx}".
   */
  globalMeasures: Map<string, MeasureDiffStatus>;
  /**
   * Part-level statuses keyed by "p{partIdx}".
   * "added" / "removed" when one document has more/fewer parts.
   */
  parts: Map<string, MeasureDiffStatus>;
  /**
   * Alignment entries per part, keyed by part index.
   * Each entry describes how original and modified measures map to each other.
   */
  alignments: Map<number, AlignmentInfo[]>;
  /**
   * Alignment entries for global measures.
   */
  globalAlignment: AlignmentInfo[];
}

/** Info about a single aligned measure pair. */
interface AlignmentInfo {
  status: MeasureDiffStatus;
  originalIndex?: number;
  modifiedIndex?: number;
}

interface MnxGlobal {
  measures?: unknown[];
}

interface AlignMnxPart {
  measures?: unknown[];
}

interface AlignMnxDocument {
  global?: MnxGlobal;
  parts?: AlignMnxPart[];
}

/**
 * Compare two MNX JSON documents at the measure level using LCS alignment.
 *
 * @param original - The original (before) MNX document
 * @param modified - The modified (after) MNX document
 * @returns A MeasureDiffResult describing which measures differ
 */
export function computeMeasureDiff(original: AlignMnxDocument, modified: AlignMnxDocument): MeasureDiffResult {
  const measures = new Map<string, MeasureDiffStatus>();
  const globalMeasures = new Map<string, MeasureDiffStatus>();
  const parts = new Map<string, MeasureDiffStatus>();
  const alignments = new Map<number, AlignmentInfo[]>();

  const origGlobal = original.global?.measures ?? [];
  const modGlobal = modified.global?.measures ?? [];
  const globalAlignment = alignGlobalMeasures(origGlobal, modGlobal, globalMeasures);

  const origParts = original.parts ?? [];
  const modParts = modified.parts ?? [];
  const maxParts = Math.max(origParts.length, modParts.length);

  for (let p = 0; p < maxParts; p++) {
    alignPartMeasures(p, origParts, modParts, measures, parts, alignments);
  }

  return { measures, globalMeasures, parts, alignments, globalAlignment };
}

function statusFromEntry(entryStatus: string): MeasureDiffStatus {
  if (entryStatus === "matched") return "unchanged";
  if (entryStatus === "modified") return "modified";
  if (entryStatus === "inserted") return "added";
  return "removed";
}

function alignGlobalMeasures(
  origGlobal: unknown[],
  modGlobal: unknown[],
  globalMeasures: Map<string, MeasureDiffStatus>,
): AlignmentInfo[] {
  const entries = alignMeasures(origGlobal, modGlobal);
  const result: AlignmentInfo[] = [];
  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx]!;
    const status = statusFromEntry(entry.status);
    globalMeasures.set(`global/m${idx}`, status);
    result.push({ status, originalIndex: entry.originalIndex, modifiedIndex: entry.modifiedIndex });
  }
  return result;
}

function alignPartMeasures(
  p: number,
  origParts: AlignMnxPart[],
  modParts: AlignMnxPart[],
  measures: Map<string, MeasureDiffStatus>,
  parts: Map<string, MeasureDiffStatus>,
  alignments: Map<number, AlignmentInfo[]>,
): void {
  const partKey = `p${p}`;

  if (p >= origParts.length) {
    parts.set(partKey, "added");
    const modMeasures = modParts[p]!.measures ?? [];
    for (let m = 0; m < modMeasures.length; m++) measures.set(`p${p}/m${m}`, "added");
    return;
  }

  if (p >= modParts.length) {
    parts.set(partKey, "removed");
    const origMeasures = origParts[p]!.measures ?? [];
    for (let m = 0; m < origMeasures.length; m++) measures.set(`p${p}/m${m}`, "removed");
    return;
  }

  parts.set(partKey, "unchanged");
  const origMeasures = origParts[p]!.measures ?? [];
  const modMeasures = modParts[p]!.measures ?? [];
  const alignment = alignMeasures(origMeasures, modMeasures);
  const partAlignment: AlignmentInfo[] = [];
  let partHasChanges = false;

  for (let idx = 0; idx < alignment.length; idx++) {
    const entry = alignment[idx]!;
    const status = statusFromEntry(entry.status);
    if (status !== "unchanged") partHasChanges = true;
    measures.set(`p${p}/m${idx}`, status);
    partAlignment.push({ status, originalIndex: entry.originalIndex, modifiedIndex: entry.modifiedIndex });
  }

  alignments.set(p, partAlignment);
  if (partHasChanges) parts.set(partKey, "modified");
}

/**
 * Measure-level MNX diff: compare two MNX JSON documents and produce
 * a structured list of human-readable change descriptions.
 */

/** A single change description for the diff summary panel. */
export interface DiffChange {
  /** Location key, e.g. "global/m0", "p0/m2" */
  key: string;
  /** Human-readable label, e.g. "Measure 3" or "Time signature" */
  label: string;
  /** Change type */
  type: "modified" | "added" | "removed";
  /** Human-readable summary of what changed */
  summary: string;
  /** Part index (-1 for global) */
  partIndex: number;
  /** Measure index */
  measureIndex: number;
}

interface MnxPitch {
  step: string;
  octave: number;
  alter?: number;
}

interface MnxNote {
  pitch: MnxPitch;
  id?: string;
}

interface MnxDuration {
  base: string;
  dots?: number;
}

interface MnxEvent {
  id?: string;
  duration?: MnxDuration;
  notes?: MnxNote[];
  rest?: unknown;
  type?: string;
}

interface MnxSequence {
  content?: MnxEvent[];
}

interface MnxPartMeasure {
  sequences?: MnxSequence[];
  clefs?: unknown[];
  dynamics?: Array<{ value?: string }>;
}

interface MnxTimeSig {
  count: number;
  unit: number;
}

interface MnxKeySig {
  fifths: number;
}

interface MnxGlobalMeasure {
  time?: MnxTimeSig;
  key?: MnxKeySig;
  barline?: unknown;
  tempos?: Array<{ bpm: number }>;
}

interface MnxPart {
  name?: string;
  measures?: MnxPartMeasure[];
}

interface MnxDocument {
  global?: {
    measures?: MnxGlobalMeasure[];
  };
  parts?: MnxPart[];
}

function formatPitch(p: MnxPitch): string {
  const alter = p.alter ? (p.alter > 0 ? "♯" : "♭") : "";
  return `${p.step}${alter}${p.octave}`;
}

function formatDuration(d: MnxDuration): string {
  const dots = d.dots ? "." + ".".repeat(d.dots - 1) : "";
  return `${d.base}${dots}`;
}

function formatTimeSig(t: MnxTimeSig): string {
  return `${t.count}/${t.unit}`;
}

const KEY_NAMES: Record<number, string> = {
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

function formatKeySig(k: MnxKeySig): string {
  return KEY_NAMES[String(k.fifths) as unknown as number] ?? `${k.fifths} fifths`;
}

/** Compare two global measures and describe changes. */
function diffGlobalMeasure(
  orig: MnxGlobalMeasure | undefined,
  mod: MnxGlobalMeasure | undefined,
  measureIndex: number,
): DiffChange[] {
  const changes: DiffChange[] = [];
  if (!orig && !mod) return changes;
  const label = `Measure ${measureIndex + 1}`;

  emitChange(
    changes,
    orig?.time,
    mod?.time,
    `global/m${measureIndex}/time`,
    label,
    measureIndex,
    "Time signature",
    (t) => formatTimeSig(t),
  );
  emitChange(changes, orig?.key, mod?.key, `global/m${measureIndex}/key`, label, measureIndex, "Key signature", (k) =>
    formatKeySig(k),
  );
  emitChange(
    changes,
    orig?.tempos?.[0],
    mod?.tempos?.[0],
    `global/m${measureIndex}/tempo`,
    label,
    measureIndex,
    "Tempo",
    (t) => `${t.bpm} BPM`,
  );

  if (JSON.stringify(orig?.barline) !== JSON.stringify(mod?.barline)) {
    changes.push({
      key: `global/m${measureIndex}/barline`,
      label,
      type: "modified",
      summary: "Barline changed",
      partIndex: -1,
      measureIndex,
    });
  }

  return changes;
}

/** Emit a modified/added/removed DiffChange for an optional property pair. */
function emitChange<T>(
  changes: DiffChange[],
  orig: T | undefined,
  mod: T | undefined,
  key: string,
  label: string,
  measureIndex: number,
  propName: string,
  format: (v: T) => string,
): void {
  if (JSON.stringify(orig) === JSON.stringify(mod)) return;
  if (orig && mod) {
    changes.push({
      key,
      label,
      type: "modified",
      summary: `${propName}: ${format(orig)} → ${format(mod)}`,
      partIndex: -1,
      measureIndex,
    });
  } else if (mod) {
    changes.push({
      key,
      label,
      type: "added",
      summary: `${propName} added: ${format(mod)}`,
      partIndex: -1,
      measureIndex,
    });
  } else if (orig) {
    changes.push({
      key,
      label,
      type: "removed",
      summary: `${propName} removed: ${format(orig)}`,
      partIndex: -1,
      measureIndex,
    });
  }
}

/** Describe changes within a single part measure (note-level detail). */
function diffPartMeasure(
  orig: MnxPartMeasure,
  mod: MnxPartMeasure,
  partIndex: number,
  partName: string,
  measureIndex: number,
): DiffChange[] {
  const changes: DiffChange[] = [];
  const origSeqs = orig.sequences ?? [];
  const modSeqs = mod.sequences ?? [];

  // Compare sequences (voices)
  const maxSeqs = Math.max(origSeqs.length, modSeqs.length);
  for (let s = 0; s < maxSeqs; s++) {
    const origSeq = origSeqs[s];
    const modSeq = modSeqs[s];

    if (!origSeq && modSeq) {
      changes.push({
        key: `p${partIndex}/m${measureIndex}/s${s}`,
        label: `${partName} — Measure ${measureIndex + 1}`,
        type: "added",
        summary: `Voice ${s + 1} added`,
        partIndex,
        measureIndex,
      });
      continue;
    }
    if (origSeq && !modSeq) {
      changes.push({
        key: `p${partIndex}/m${measureIndex}/s${s}`,
        label: `${partName} — Measure ${measureIndex + 1}`,
        type: "removed",
        summary: `Voice ${s + 1} removed`,
        partIndex,
        measureIndex,
      });
      continue;
    }
    if (!origSeq || !modSeq) continue;

    // Compare events within the sequence
    const origContent = origSeq.content ?? [];
    const modContent = modSeq.content ?? [];
    const eventChanges = diffEvents(origContent, modContent);

    for (const ec of eventChanges) {
      changes.push({
        key: `p${partIndex}/m${measureIndex}/s${s}/e${ec.eventIndex}`,
        label: `${partName} — Measure ${measureIndex + 1}`,
        type: ec.type,
        summary: ec.summary,
        partIndex,
        measureIndex,
      });
    }
  }

  // Dynamics changes
  const origDyn = orig.dynamics;
  const modDyn = mod.dynamics;
  if (JSON.stringify(origDyn) !== JSON.stringify(modDyn)) {
    if (!origDyn && modDyn) {
      const vals = modDyn.map((d) => d.value ?? "?").join(", ");
      changes.push({
        key: `p${partIndex}/m${measureIndex}/dynamics`,
        label: `${partName} — Measure ${measureIndex + 1}`,
        type: "added",
        summary: `Dynamics added: ${vals}`,
        partIndex,
        measureIndex,
      });
    } else if (origDyn && !modDyn) {
      changes.push({
        key: `p${partIndex}/m${measureIndex}/dynamics`,
        label: `${partName} — Measure ${measureIndex + 1}`,
        type: "removed",
        summary: "Dynamics removed",
        partIndex,
        measureIndex,
      });
    } else {
      changes.push({
        key: `p${partIndex}/m${measureIndex}/dynamics`,
        label: `${partName} — Measure ${measureIndex + 1}`,
        type: "modified",
        summary: "Dynamics changed",
        partIndex,
        measureIndex,
      });
    }
  }

  // If no specific changes were found but measures differ, add generic change
  if (changes.length === 0) {
    changes.push({
      key: `p${partIndex}/m${measureIndex}`,
      label: `${partName} — Measure ${measureIndex + 1}`,
      type: "modified",
      summary: "Content changed",
      partIndex,
      measureIndex,
    });
  }

  return changes;
}

interface EventChange {
  eventIndex: number;
  type: "modified" | "added" | "removed";
  summary: string;
}

/** Compare events within a sequence and describe changes. */
function diffEvents(origEvents: MnxEvent[], modEvents: MnxEvent[]): EventChange[] {
  const changes: EventChange[] = [];
  const maxEvents = Math.max(origEvents.length, modEvents.length);

  for (let i = 0; i < maxEvents; i++) {
    const origEv = origEvents[i];
    const modEv = modEvents[i];

    if (!origEv && modEv) {
      changes.push({ eventIndex: i, type: "added", summary: `Event added: ${describeEvent(modEv)}` });
      continue;
    }
    if (origEv && !modEv) {
      changes.push({ eventIndex: i, type: "removed", summary: `Event removed: ${describeEvent(origEv)}` });
      continue;
    }
    if (!origEv || !modEv) continue;
    if (JSON.stringify(origEv) === JSON.stringify(modEv)) continue;

    const details = describeEventChanges(origEv, modEv);
    changes.push({
      eventIndex: i,
      type: "modified",
      summary: details.length > 0 ? details.join("; ") : "Event modified",
    });
  }

  return changes;
}

function describeEventChanges(origEv: MnxEvent, modEv: MnxEvent): string[] {
  const details: string[] = [];
  describeNoteChanges(origEv.notes ?? [], modEv.notes ?? [], details);
  if (origEv.duration && modEv.duration && JSON.stringify(origEv.duration) !== JSON.stringify(modEv.duration)) {
    details.push(`duration: ${formatDuration(origEv.duration)} → ${formatDuration(modEv.duration)}`);
  }
  return details;
}

function describeNoteChanges(origNotes: MnxNote[], modNotes: MnxNote[], details: string[]): void {
  if (origNotes.length > 0 && modNotes.length > 0) {
    for (let n = 0; n < Math.max(origNotes.length, modNotes.length); n++) {
      const oNote = origNotes[n];
      const mNote = modNotes[n];
      if (!oNote && mNote) details.push(`note added (${formatPitch(mNote.pitch)})`);
      else if (oNote && !mNote) details.push(`note removed (${formatPitch(oNote.pitch)})`);
      else if (oNote && mNote && JSON.stringify(oNote.pitch) !== JSON.stringify(mNote.pitch)) {
        details.push(`${formatPitch(oNote.pitch)} → ${formatPitch(mNote.pitch)}`);
      }
    }
  } else if (origNotes.length === 0 && modNotes.length > 0) {
    details.push(`rest → ${modNotes.map((n) => formatPitch(n.pitch)).join(", ")}`);
  } else if (origNotes.length > 0 && modNotes.length === 0) {
    details.push(`${origNotes.map((n) => formatPitch(n.pitch)).join(", ")} → rest`);
  }
}

function describeEvent(ev: MnxEvent): string {
  if (ev.rest !== undefined || !ev.notes || ev.notes.length === 0) {
    return ev.duration ? `rest (${formatDuration(ev.duration)})` : "rest";
  }
  const pitches = ev.notes.map((n) => formatPitch(n.pitch)).join(", ");
  const dur = ev.duration ? ` (${formatDuration(ev.duration)})` : "";
  return `${pitches}${dur}`;
}

/**
 * Compute a full diff summary between two MNX JSON documents.
 * Returns a flat list of DiffChange items suitable for display.
 */
export function computeDiffSummary(originalJson: string, modifiedJson: string): DiffChange[] {
  let orig: MnxDocument;
  let mod: MnxDocument;
  try {
    orig = JSON.parse(originalJson) as MnxDocument;
    mod = JSON.parse(modifiedJson) as MnxDocument;
  } catch {
    return [];
  }

  const changes: DiffChange[] = [];
  collectGlobalMeasureChanges(orig, mod, changes);
  collectPartChanges(orig, mod, changes);
  return changes;
}

function collectGlobalMeasureChanges(orig: MnxDocument, mod: MnxDocument, changes: DiffChange[]): void {
  const origGlobal = orig.global?.measures ?? [];
  const modGlobal = mod.global?.measures ?? [];
  const maxGlobal = Math.max(origGlobal.length, modGlobal.length);
  for (let i = 0; i < maxGlobal; i++) {
    if (i >= origGlobal.length) {
      changes.push({
        key: `global/m${i}`,
        label: `Measure ${i + 1}`,
        type: "added",
        summary: "Measure added (global)",
        partIndex: -1,
        measureIndex: i,
      });
      continue;
    }
    if (i >= modGlobal.length) {
      changes.push({
        key: `global/m${i}`,
        label: `Measure ${i + 1}`,
        type: "removed",
        summary: "Measure removed (global)",
        partIndex: -1,
        measureIndex: i,
      });
      continue;
    }
    changes.push(...diffGlobalMeasure(origGlobal[i], modGlobal[i], i));
  }
}

function collectPartChanges(orig: MnxDocument, mod: MnxDocument, changes: DiffChange[]): void {
  const origParts = orig.parts ?? [];
  const modParts = mod.parts ?? [];
  const maxParts = Math.max(origParts.length, modParts.length);
  for (let p = 0; p < maxParts; p++) {
    const origPart = origParts[p];
    const modPart = modParts[p];
    const partName = modPart?.name ?? origPart?.name ?? `Part ${p + 1}`;

    if (!origPart) {
      changes.push({
        key: `p${p}`,
        label: partName,
        type: "added",
        summary: "Part added",
        partIndex: p,
        measureIndex: -1,
      });
      continue;
    }
    if (!modPart) {
      changes.push({
        key: `p${p}`,
        label: partName,
        type: "removed",
        summary: "Part removed",
        partIndex: p,
        measureIndex: -1,
      });
      continue;
    }
    collectPartMeasureChanges(origPart, modPart, p, partName, changes);
  }
}

function collectPartMeasureChanges(
  origPart: MnxPart,
  modPart: MnxPart,
  p: number,
  partName: string,
  changes: DiffChange[],
): void {
  const origMeasures = origPart.measures ?? [];
  const modMeasures = modPart.measures ?? [];
  const maxMeasures = Math.max(origMeasures.length, modMeasures.length);

  for (let m = 0; m < maxMeasures; m++) {
    const origM = origMeasures[m];
    const modM = modMeasures[m];

    if (!origM && modM) {
      changes.push({
        key: `p${p}/m${m}`,
        label: `${partName} — Measure ${m + 1}`,
        type: "added",
        summary: "Measure added",
        partIndex: p,
        measureIndex: m,
      });
      continue;
    }
    if (origM && !modM) {
      changes.push({
        key: `p${p}/m${m}`,
        label: `${partName} — Measure ${m + 1}`,
        type: "removed",
        summary: "Measure removed",
        partIndex: p,
        measureIndex: m,
      });
      continue;
    }
    if (!origM || !modM) continue;
    if (JSON.stringify(origM) !== JSON.stringify(modM)) {
      changes.push(...diffPartMeasure(origM, modM, p, partName, m));
    }
  }
}

/**
 * Get the effective status for a given measure index,
 * considering both global and part-level changes.
 * If any part has a change in that measure, or global has a change, return the "worst" status.
 */
export function getMeasureOverallStatus(diff: MeasureDiffResult, measureIndex: number): MeasureDiffStatus {
  const globalStatus = diff.globalMeasures.get(`global/m${measureIndex}`);

  let hasModified = globalStatus === "modified";
  let hasAdded = globalStatus === "added";
  let hasRemoved = globalStatus === "removed";

  for (const [key, status] of diff.measures) {
    if (!key.startsWith("p")) continue;
    const match = key.match(/^p\d+\/m(\d+)$/);
    if (match && match[1] !== undefined && parseInt(match[1], 10) === measureIndex) {
      if (status === "modified") hasModified = true;
      if (status === "added") hasAdded = true;
      if (status === "removed") hasRemoved = true;
    }
  }

  if (hasModified) return "modified";
  if (hasAdded) return "added";
  if (hasRemoved) return "removed";
  return "unchanged";
}
