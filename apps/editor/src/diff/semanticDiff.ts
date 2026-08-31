/**
 * Semantic diff tree — MNX-aware structural comparison.
 *
 * Walks two MNX documents in parallel, producing a tree of DiffNode objects
 * that describe what changed at each structural level (global, parts,
 * measures, sequences, events, notes).
 */

import {
  type DiffType,
  type DiffNode,
  type MnxNote,
  type MnxEvent,
  type MnxSequence,
  type MnxPartMeasure,
  type MnxPart,
  type MnxGlobalMeasure,
  type MnxDocument,
  jsonSnippet,
  stableHash,
  deepEqual,
  pitchLabel,
  durationLabel,
  eventLabel,
  summarizeGlobalMeasureChange,
} from "./semanticDiffHelpers";
import { lcsAlign, lcsAlignWithModifications } from "./lcsAlign";

// Re-export public surface for existing callers/tests.
export type { DiffType, DiffNode };
export { lcsAlign, lcsAlignWithModifications };

// ─── Core diff functions ────────────────────────────────────────

function diffNotes(path: string, label: string, before: MnxNote[], after: MnxNote[]): DiffNode[] {
  const nodes: DiffNode[] = [];
  const maxLen = Math.max(before.length, after.length);

  for (let i = 0; i < maxLen; i++) {
    const b = before[i];
    const a = after[i];
    const notePath = `${path}.notes[${i}]`;

    if (!b && a) {
      nodes.push({
        path: notePath,
        label: `${label} → Note ${i + 1}`,
        type: "added",
        summary: `Added: ${pitchLabel(a.pitch)}`,
        afterJson: jsonSnippet(a),
      });
    } else if (b && !a) {
      nodes.push({
        path: notePath,
        label: `${label} → Note ${i + 1}`,
        type: "removed",
        summary: `Removed: ${pitchLabel(b.pitch)}`,
        beforeJson: jsonSnippet(b),
      });
    } else if (b && a && !deepEqual(b, a)) {
      const summaryParts: string[] = [];
      if (b.pitch.step !== a.pitch.step || b.pitch.octave !== a.pitch.octave || b.pitch.alter !== a.pitch.alter) {
        summaryParts.push(`Pitch ${pitchLabel(b.pitch)} → ${pitchLabel(a.pitch)}`);
      }
      if (!deepEqual(b.pitch, a.pitch) && summaryParts.length === 0) {
        summaryParts.push(`Pitch ${pitchLabel(b.pitch)} → ${pitchLabel(a.pitch)}`);
      }
      // Check other note-level properties
      if (JSON.stringify(b.ties) !== JSON.stringify(a.ties)) {
        summaryParts.push("Ties changed");
      }
      if (JSON.stringify(b.accidentalDisplay) !== JSON.stringify(a.accidentalDisplay)) {
        summaryParts.push("Accidental display changed");
      }
      if (summaryParts.length === 0) {
        summaryParts.push("Note properties changed");
      }
      nodes.push({
        path: notePath,
        label: `${label} → Note ${i + 1}`,
        type: "modified",
        summary: summaryParts.join("; "),
        beforeJson: jsonSnippet(b),
        afterJson: jsonSnippet(a),
      });
    }
  }

  return nodes;
}

function diffEvents(path: string, label: string, before: MnxEvent[], after: MnxEvent[]): DiffNode[] {
  const nodes: DiffNode[] = [];
  const maxLen = Math.max(before.length, after.length);

  for (let i = 0; i < maxLen; i++) {
    const b = before[i];
    const a = after[i];
    const evPath = `${path}.content[${i}]`;
    const evNum = i + 1;

    if (!b && a) {
      nodes.push({
        path: evPath,
        label: `${label} → Event ${evNum}`,
        type: "added",
        summary: `Added: ${eventLabel(a)}`,
        afterJson: jsonSnippet(a),
      });
    } else if (b && !a) {
      nodes.push({
        path: evPath,
        label: `${label} → Event ${evNum}`,
        type: "removed",
        summary: `Removed: ${eventLabel(b)}`,
        beforeJson: jsonSnippet(b),
      });
    } else if (b && a && !deepEqual(b, a)) {
      const { summaryParts, children } = summarizeEventChange(evPath, `${label} → Event ${evNum}`, b, a);

      const node: DiffNode = {
        path: evPath,
        label: `${label} → Event ${evNum}`,
        type: "modified",
        summary: summaryParts.join("; "),
        beforeJson: jsonSnippet(b),
        afterJson: jsonSnippet(a),
      };
      if (children.length > 0) {
        node.children = children;
      }
      nodes.push(node);
    }
  }

  return nodes;
}

function summarizeEventChange(
  evPath: string,
  evLabel: string,
  b: MnxEvent,
  a: MnxEvent,
): { summaryParts: string[]; children: DiffNode[] } {
  const summaryParts: string[] = [];
  const children: DiffNode[] = [];

  // Duration change
  if (b.duration && a.duration && !deepEqual(b.duration, a.duration)) {
    summaryParts.push(`Duration ${durationLabel(b.duration)} → ${durationLabel(a.duration)}`);
  }

  // Rest ↔ notes change
  if (b.rest !== undefined && a.rest === undefined) {
    summaryParts.push("Rest → notes");
  } else if (b.rest === undefined && a.rest !== undefined) {
    summaryParts.push("Notes → rest");
  }

  // Note-level diff
  const bNotes = b.notes ?? [];
  const aNotes = a.notes ?? [];
  if (!deepEqual(bNotes, aNotes)) {
    const noteChildren = diffNotes(evPath, evLabel, bNotes, aNotes);
    children.push(...noteChildren);
    if (summaryParts.length === 0 && noteChildren.length > 0 && noteChildren[0]) {
      summaryParts.push(noteChildren[0].summary);
    }
  }

  // Markings change
  if (!deepEqual(b.markings, a.markings)) {
    summaryParts.push("Markings changed");
  }
  // Slurs change
  if (!deepEqual(b.slurs, a.slurs)) {
    summaryParts.push("Slurs changed");
  }
  // Lyrics change
  if (!deepEqual(b.lyrics, a.lyrics)) {
    summaryParts.push("Lyrics changed");
  }

  if (summaryParts.length === 0) {
    summaryParts.push("Event modified");
  }
  return { summaryParts, children };
}

function diffSequences(path: string, label: string, before: MnxSequence[], after: MnxSequence[]): DiffNode[] {
  const nodes: DiffNode[] = [];
  const maxLen = Math.max(before.length, after.length);

  for (let i = 0; i < maxLen; i++) {
    const b = before[i];
    const a = after[i];
    const seqPath = `${path}.sequences[${i}]`;
    const voiceName = a?.voice ?? b?.voice ?? `Voice ${i + 1}`;
    const seqLabel = `${label} → ${voiceName}`;

    if (!b && a) {
      nodes.push({
        path: seqPath,
        label: seqLabel,
        type: "added",
        summary: `Added: ${voiceName}`,
        afterJson: jsonSnippet(a),
      });
    } else if (b && !a) {
      nodes.push({
        path: seqPath,
        label: seqLabel,
        type: "removed",
        summary: `Removed: ${voiceName}`,
        beforeJson: jsonSnippet(b),
      });
    } else if (b && a && !deepEqual(b, a)) {
      const children = diffEvents(seqPath, seqLabel, b.content, a.content);
      const summary =
        children.length > 0 && children[0]
          ? children.length === 1
            ? children[0].summary
            : `${children.length} events changed`
          : "Sequence modified";

      const node: DiffNode = {
        path: seqPath,
        label: seqLabel,
        type: "modified",
        summary,
        beforeJson: jsonSnippet(b),
        afterJson: jsonSnippet(a),
      };
      if (children.length > 0) {
        node.children = children;
      }
      nodes.push(node);
    }
  }

  return nodes;
}

function diffPartMeasures(
  path: string,
  partLabel: string,
  before: MnxPartMeasure[],
  after: MnxPartMeasure[],
): DiffNode[] {
  // Use LCS alignment with modification pairing for measures
  const alignment = lcsAlignWithModifications(before, after, stableHash);
  const nodes: DiffNode[] = [];

  for (const entry of alignment) {
    if (entry.type === "match" && entry.originalIndex !== undefined && entry.modifiedIndex !== undefined) {
      const b = before[entry.originalIndex]!;
      const a = after[entry.modifiedIndex]!;
      const mPath = `${path}.measures[${entry.modifiedIndex}]`;
      const mLabel = `${partLabel} → Measure ${entry.modifiedIndex + 1}`;

      if (!deepEqual(b, a)) {
        const children: DiffNode[] = [];
        const summaryParts: string[] = [];

        // Clef changes
        if (!deepEqual(b.clefs, a.clefs)) {
          summaryParts.push("Clefs changed");
        }

        // Dynamics changes
        if (!deepEqual(b.dynamics, a.dynamics)) {
          summaryParts.push("Dynamics changed");
        }

        // Beam changes
        if (!deepEqual(b.beams, a.beams)) {
          summaryParts.push("Beams changed");
        }

        // Sequence-level diff
        const bSeqs = b.sequences ?? [];
        const aSeqs = a.sequences ?? [];
        if (!deepEqual(bSeqs, aSeqs)) {
          const seqChildren = diffSequences(mPath, mLabel, bSeqs, aSeqs);
          children.push(...seqChildren);
        }

        const summary =
          children.length > 0 && children[0]
            ? children.length === 1
              ? children[0].summary
              : `${children.length} voices changed`
            : summaryParts.length > 0
              ? summaryParts.join("; ")
              : "Measure modified";

        const node: DiffNode = {
          path: mPath,
          label: mLabel,
          type: "modified",
          summary,
          beforeJson: jsonSnippet(b),
          afterJson: jsonSnippet(a),
        };
        if (children.length > 0) {
          node.children = children;
        }
        nodes.push(node);
      }
    } else if (entry.type === "added" && entry.modifiedIndex !== undefined) {
      const a = after[entry.modifiedIndex]!;
      nodes.push({
        path: `${path}.measures[${entry.modifiedIndex}]`,
        label: `${partLabel} → Measure ${entry.modifiedIndex + 1}`,
        type: "added",
        summary: "Measure added",
        afterJson: jsonSnippet(a),
      });
    } else if (entry.type === "removed" && entry.originalIndex !== undefined) {
      const b = before[entry.originalIndex]!;
      nodes.push({
        path: `${path}.measures[${entry.originalIndex}]`,
        label: `${partLabel} → Measure ${entry.originalIndex + 1}`,
        type: "removed",
        summary: "Measure removed",
        beforeJson: jsonSnippet(b),
      });
    }
  }

  return nodes;
}

function diffGlobalMeasures(before: MnxGlobalMeasure[], after: MnxGlobalMeasure[]): DiffNode[] {
  const alignment = lcsAlignWithModifications(before, after, stableHash);
  const nodes: DiffNode[] = [];

  for (const entry of alignment) {
    if (entry.type === "match" && entry.originalIndex !== undefined && entry.modifiedIndex !== undefined) {
      const b = before[entry.originalIndex]!;
      const a = after[entry.modifiedIndex]!;
      const mPath = `global.measures[${entry.modifiedIndex}]`;
      const mLabel = `Global → Measure ${entry.modifiedIndex + 1}`;

      if (!deepEqual(b, a)) {
        const summaryParts = summarizeGlobalMeasureChange(b, a);
        nodes.push({
          path: mPath,
          label: mLabel,
          type: "modified",
          summary: summaryParts.join("; "),
          beforeJson: jsonSnippet(b),
          afterJson: jsonSnippet(a),
        });
      }
    } else if (entry.type === "added" && entry.modifiedIndex !== undefined) {
      nodes.push({
        path: `global.measures[${entry.modifiedIndex}]`,
        label: `Global → Measure ${entry.modifiedIndex + 1}`,
        type: "added",
        summary: "Global measure added",
        afterJson: jsonSnippet(after[entry.modifiedIndex]),
      });
    } else if (entry.type === "removed" && entry.originalIndex !== undefined) {
      nodes.push({
        path: `global.measures[${entry.originalIndex}]`,
        label: `Global → Measure ${entry.originalIndex + 1}`,
        type: "removed",
        summary: "Global measure removed",
        beforeJson: jsonSnippet(before[entry.originalIndex]),
      });
    }
  }

  return nodes;
}

function diffModifiedPart(b: MnxPart, a: MnxPart, pPath: string, pLabel: string): DiffNode | undefined {
  if (deepEqual(b, a)) return undefined;

  const children: DiffNode[] = [];
  const summaryParts: string[] = [];

  if (b.name !== a.name) {
    summaryParts.push(`Name: "${b.name ?? ""}" → "${a.name ?? ""}"`);
  }
  if (b.staves !== a.staves) {
    summaryParts.push(`Staves: ${b.staves ?? 1} → ${a.staves ?? 1}`);
  }

  const measureChildren = diffPartMeasures(pPath, pLabel, b.measures, a.measures);
  children.push(...measureChildren);

  const summary =
    children.length > 0
      ? children.length === 1 && children[0]
        ? children[0].summary
        : `${children.length} measures changed`
      : summaryParts.length > 0
        ? summaryParts.join("; ")
        : "Part modified";

  const node: DiffNode = {
    path: pPath,
    label: pLabel,
    type: "modified",
    summary,
    beforeJson: jsonSnippet(b),
    afterJson: jsonSnippet(a),
  };
  if (children.length > 0) {
    node.children = children;
  }
  return node;
}

function diffParts(before: MnxPart[], after: MnxPart[]): DiffNode[] {
  // Align parts by name/id with LCS + modification pairing
  const alignment = lcsAlignWithModifications(before, after, (p) => p.id ?? p.name ?? "");
  const nodes: DiffNode[] = [];

  for (const entry of alignment) {
    if (entry.type === "match" && entry.originalIndex !== undefined && entry.modifiedIndex !== undefined) {
      const b = before[entry.originalIndex]!;
      const a = after[entry.modifiedIndex]!;
      const pPath = `parts[${entry.modifiedIndex}]`;
      const partName = a.name ?? a.id ?? `Part ${entry.modifiedIndex + 1}`;
      const node = diffModifiedPart(b, a, pPath, partName);
      if (node) nodes.push(node);
    } else if (entry.type === "added" && entry.modifiedIndex !== undefined) {
      const a = after[entry.modifiedIndex]!;
      const partName = a.name ?? a.id ?? `Part ${entry.modifiedIndex + 1}`;
      nodes.push({
        path: `parts[${entry.modifiedIndex}]`,
        label: partName,
        type: "added",
        summary: `Added part: ${partName}`,
        afterJson: jsonSnippet(a),
      });
    } else if (entry.type === "removed" && entry.originalIndex !== undefined) {
      const b = before[entry.originalIndex]!;
      const partName = b.name ?? b.id ?? `Part ${entry.originalIndex + 1}`;
      nodes.push({
        path: `parts[${entry.originalIndex}]`,
        label: partName,
        type: "removed",
        summary: `Removed part: ${partName}`,
        beforeJson: jsonSnippet(b),
      });
    }
  }

  return nodes;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Produce a semantic diff tree comparing two MNX documents.
 *
 * @param original  The original (before) MNX document as a parsed JSON object.
 * @param modified  The modified (after) MNX document as a parsed JSON object.
 * @returns The root DiffNode representing the entire comparison.
 */
export function semanticDiff(original: unknown, modified: unknown): DiffNode {
  const before = original as MnxDocument;
  const after = modified as MnxDocument;

  if (deepEqual(before, after)) {
    return {
      path: "",
      label: "Score",
      type: "unchanged",
      summary: "No changes",
    };
  }

  const children: DiffNode[] = [];

  // Version change (rare but possible)
  if (!deepEqual(before.mnx, after.mnx)) {
    children.push({
      path: "mnx",
      label: "MNX Version",
      type: "modified",
      summary: `Version ${before.mnx?.version ?? "?"} → ${after.mnx?.version ?? "?"}`,
      beforeJson: jsonSnippet(before.mnx),
      afterJson: jsonSnippet(after.mnx),
    });
  }

  // Global measures
  const bGlobal = before.global?.measures ?? [];
  const aGlobal = after.global?.measures ?? [];
  if (!deepEqual(bGlobal, aGlobal)) {
    const globalChildren = diffGlobalMeasures(bGlobal, aGlobal);
    if (globalChildren.length > 0) {
      children.push({
        path: "global",
        label: "Global",
        type: "modified",
        summary:
          globalChildren.length === 1 && globalChildren[0]
            ? globalChildren[0].summary
            : `${globalChildren.length} global measures changed`,
        children: globalChildren,
      });
    }
  }

  // Layouts
  if (!deepEqual(before.layouts, after.layouts)) {
    children.push({
      path: "layouts",
      label: "Layouts",
      type: "modified",
      summary: "Layout definitions changed",
      beforeJson: jsonSnippet(before.layouts),
      afterJson: jsonSnippet(after.layouts),
    });
  }

  // Scores
  if (!deepEqual(before.scores, after.scores)) {
    children.push({
      path: "scores",
      label: "Scores",
      type: "modified",
      summary: "Score definitions changed",
      beforeJson: jsonSnippet(before.scores),
      afterJson: jsonSnippet(after.scores),
    });
  }

  // Parts
  const bParts = before.parts ?? [];
  const aParts = after.parts ?? [];
  if (!deepEqual(bParts, aParts)) {
    const partChildren = diffParts(bParts, aParts);
    children.push(...partChildren);
  }

  const root: DiffNode = {
    path: "",
    label: "Score",
    type: "modified",
    summary: children.length === 1 && children[0] ? children[0].summary : `${children.length} sections changed`,
  };
  if (children.length > 0) {
    root.children = children;
  }
  return root;
}

/**
 * Collect all leaf DiffNodes (nodes with no children) from a diff tree.
 * Useful for displaying a flat list of changes.
 */
export function collectLeaves(node: DiffNode): DiffNode[] {
  if (!node.children || node.children.length === 0) {
    return node.type === "unchanged" ? [] : [node];
  }
  const leaves: DiffNode[] = [];
  for (const child of node.children) {
    leaves.push(...collectLeaves(child));
  }
  return leaves;
}

/**
 * Count the number of changes in a diff tree by type.
 */
export function countChanges(node: DiffNode): Record<DiffType, number> {
  const counts: Record<DiffType, number> = {
    unchanged: 0,
    modified: 0,
    added: 0,
    removed: 0,
  };
  const leaves = collectLeaves(node);
  for (const leaf of leaves) {
    counts[leaf.type]++;
  }
  return counts;
}
