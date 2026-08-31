/**
 * Structural document statistics + diff summary backing the review surface for
 * whole-document (`preview.propose_mnx`) proposals.
 *
 * A 40,000-line JSON diff is not reviewable. Instead we summarise a document by
 * the counts a musician actually reasons about — bars, parts, tempos, meter and
 * key changes, events, notes, dynamics — and present the before/after/delta of
 * each so a human can sanity-check the shape of a large proposal at a glance.
 */

import type { Score } from "@viritura/core";

interface PitchWalkNode {
  readonly type?: string;
  readonly notes?: readonly unknown[];
  readonly content?: readonly PitchWalkNode[];
}

interface DocumentStats {
  measures: number;
  parts: number;
  events: number;
  notes: number;
  tempos: number;
  timeSignatures: number;
  keyChanges: number;
  dynamics: number;
}

interface StructuralDiffMetric {
  label: string;
  before: number;
  after: number;
  delta: number;
}

export interface StructuralDiffSummary {
  metrics: StructuralDiffMetric[];
}

function summarizeDocument(score: Score): DocumentStats {
  let events = 0;
  let notes = 0;
  let dynamics = 0;
  for (const part of score.parts) {
    for (const measure of part.measures) {
      dynamics += measure.dynamics?.length ?? 0;
      for (const seq of measure.sequences) {
        const counts = countContent(seq.content);
        events += counts.events;
        notes += counts.notes;
      }
    }
  }

  let tempos = 0;
  let timeSignatures = 0;
  let keyChanges = 0;
  for (const measure of score.global.measures) {
    tempos += measure.tempos?.length ?? 0;
    if (measure.time) timeSignatures++;
    if (measure.key) keyChanges++;
  }

  return {
    measures: score.global.measures.length,
    parts: score.parts.length,
    events,
    notes,
    tempos,
    timeSignatures,
    keyChanges,
    dynamics,
  };
}

export function diffDocuments(before: Score, after: Score): StructuralDiffSummary {
  const a = summarizeDocument(before);
  const b = summarizeDocument(after);
  const metric = (label: string, key: keyof DocumentStats): StructuralDiffMetric => ({
    label,
    before: a[key],
    after: b[key],
    delta: b[key] - a[key],
  });
  return {
    metrics: [
      metric("Measures", "measures"),
      metric("Parts", "parts"),
      metric("Events", "events"),
      metric("Notes", "notes"),
      metric("Tempos", "tempos"),
      metric("Time signatures", "timeSignatures"),
      metric("Key changes", "keyChanges"),
      metric("Dynamics", "dynamics"),
    ],
  };
}

function countContent(content: readonly PitchWalkNode[]): { events: number; notes: number } {
  let events = 0;
  let notes = 0;
  for (const node of content) {
    if (node.type === "event") {
      events++;
      notes += node.notes?.length ?? 0;
    }
    if (node.content) {
      const nested = countContent(node.content);
      events += nested.events;
      notes += nested.notes;
    }
  }
  return { events, notes };
}
