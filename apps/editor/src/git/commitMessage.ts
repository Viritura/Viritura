/**
 * Auto-generated commit message synthesizer.
 *
 * Per docs/plans/git-versioning.md, users never type a commit message.
 * Instead we run the existing semanticDiff between the previous and current
 * MNX content, then format the change list into a short message.
 *
 * Format:
 *   "<type>: <first change name>"                  // 1 change
 *   "<type>: <first change>, +N more changes"      // 2..3 changes
 *   "<type>: N changes across M parts"             // many changes
 */

import { collectLeaves, semanticDiff, type DiffNode } from "../diff/semanticDiff";

type CommitKind = "edit" | "structure" | "layout";

export interface SynthesizedCommitMessage {
  /** Final formatted line, e.g. "Edit: Flute → Measure 3 · pitch D4 → E4". */
  subject: string;
  /** Categorisation, useful for analytics or future per-type icons. */
  kind: CommitKind;
  /** Number of changed leaves. */
  changeCount: number;
  /** True when there are no semantic changes. */
  empty: boolean;
}

interface Options {
  /** Tag the message as an auto-snapshot (appends " [auto]"). */
  auto?: boolean;
  /** When the previous MNX is missing this is the first commit; force this title. */
  initialTitle?: string;
}

/** Best-effort parse — returns null if the input isn't valid JSON. */
function safeParse(json: string): unknown | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

function classify(leaves: DiffNode[]): CommitKind {
  // Prefer "structure" when any leaf path indicates structural surgery
  // (parts added/removed, global measure changes, time/key signatures).
  for (const leaf of leaves) {
    const p = leaf.path;
    if (
      leaf.type === "added" ||
      leaf.type === "removed" ||
      p === "" ||
      p.startsWith("global") ||
      p === "scores" ||
      /\.time(\b|\W)/.test(p) ||
      /\.key(\b|\W)/.test(p) ||
      /^parts(\[\d+\])?$/.test(p)
    ) {
      return "structure";
    }
  }
  // Layout-ish paths.
  for (const leaf of leaves) {
    if (leaf.path.startsWith("layouts") || leaf.path === "layouts") return "layout";
  }
  return "edit";
}

function prefix(kind: CommitKind): string {
  switch (kind) {
    case "structure":
      return "Structure";
    case "layout":
      return "Layout";
    case "edit":
      return "Edit";
  }
}

function describeLeaf(leaf: DiffNode): string {
  const label = leaf.label || "Score";
  // Prefer the diff's own summary if it adds detail beyond the label.
  if (leaf.summary && leaf.summary !== label && leaf.summary !== "Modified") {
    return `${label} · ${leaf.summary}`;
  }
  return label;
}

function countParts(leaves: DiffNode[]): number {
  const parts = new Set<string>();
  for (const leaf of leaves) {
    const m = /^parts\[(\d+)\]/.exec(leaf.path);
    if (m && m[1]) parts.add(m[1]);
  }
  return parts.size;
}

function shapeBody(leaves: DiffNode[]): string {
  if (leaves.length === 0) return "Save";
  const first = describeLeaf(leaves[0]!);
  if (leaves.length === 1) return first;
  if (leaves.length <= 3) {
    return `${first}, +${leaves.length - 1} more change${leaves.length - 1 === 1 ? "" : "s"}`;
  }
  const partCount = countParts(leaves);
  if (partCount > 1) {
    return `${leaves.length} changes across ${partCount} parts`;
  }
  return `${first}, +${leaves.length - 1} more changes`;
}

/**
 * Synthesize a commit message from two MNX JSON strings.
 *
 * @param previousMnxJson  The MNX content of the previous commit (may be empty/null).
 * @param currentMnxJson   The MNX content being committed.
 * @param opts             Optional auto / initial-title flags.
 */
export function synthesizeCommitMessage(
  previousMnxJson: string | null,
  currentMnxJson: string,
  opts: Options = {},
): SynthesizedCommitMessage {
  // Initial commit: no previous content.
  if (previousMnxJson == null || previousMnxJson === "") {
    const subject = opts.initialTitle ?? "Initial draft";
    return {
      subject: opts.auto ? `${subject} [auto]` : subject,
      kind: "structure",
      changeCount: 0,
      empty: false,
    };
  }

  const prev = safeParse(previousMnxJson);
  const next = safeParse(currentMnxJson);
  if (prev == null || next == null) {
    const fallback = `Save · ${new Date().toISOString().replace(/[:.]/g, "-")}`;
    return {
      subject: opts.auto ? `${fallback} [auto]` : fallback,
      kind: "edit",
      changeCount: 0,
      empty: false,
    };
  }

  const tree = semanticDiff(prev, next);
  const leaves = collectLeaves(tree);

  if (leaves.length === 0) {
    return {
      subject: "",
      kind: "edit",
      changeCount: 0,
      empty: true,
    };
  }

  const kind = classify(leaves);
  const body = shapeBody(leaves);
  const subject = `${prefix(kind)}: ${body}`;
  return {
    subject: opts.auto ? `${subject} [auto]` : subject,
    kind,
    changeCount: leaves.length,
    empty: false,
  };
}

/** Internal helper exposed for tests. */
const _internals: {
  classify: (leaves: DiffNode[]) => CommitKind;
  shapeBody: (leaves: DiffNode[]) => string;
  describeLeaf: (leaf: DiffNode) => string;
} = { classify, shapeBody, describeLeaf };

/** Hint to consumers about the typing. */
