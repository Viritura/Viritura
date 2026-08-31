/**
 * LCS-based measure alignment for insertions/deletions.
 *
 * Uses Longest Common Subsequence (LCS) on content hashes to align measures
 * between two versions of a score, correctly handling inserted and deleted
 * measures instead of naive index-based comparison.
 */

/** A single entry in the alignment result. */
export interface AlignmentEntry {
  /** "matched" = same content at both indices, "modified" = paired but different, "inserted" = only in modified, "deleted" = only in original */
  status: "matched" | "modified" | "inserted" | "deleted";
  /** Index in the original array (undefined for insertions) */
  originalIndex?: number;
  /** Index in the modified array (undefined for deletions) */
  modifiedIndex?: number;
}

/**
 * Stable-stringify a value for hashing purposes.
 * Sorts object keys so that key order doesn't cause false diffs.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

/**
 * Compute the forward LCS table: dp[i][j] = LCS length of a[0..i-1] and b[0..j-1].
 */
function _computeLCSTable(a: readonly string[], b: readonly string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  return dp;
}

/**
 * Compute the suffix LCS table: rdp[i][j] = LCS length of a[i..n-1] and b[j..m-1].
 */
function computeSuffixLCSTable(a: readonly string[], b: readonly string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const rdp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        rdp[i]![j] = rdp[i + 1]![j + 1]! + 1;
      } else {
        rdp[i]![j] = Math.max(rdp[i + 1]![j]!, rdp[i]![j + 1]!);
      }
    }
  }

  return rdp;
}

/**
 * Forward-trace through LCS tables to produce a leftmost-matching alignment,
 * then merge adjacent deleted+inserted pairs into "modified" entries.
 */
function forwardAlign(a: readonly string[], b: readonly string[], rdp: number[][]): AlignmentEntry[] {
  const raw: AlignmentEntry[] = [];
  const n = a.length;
  const m = b.length;
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      raw.push({ status: "matched", originalIndex: i, modifiedIndex: j });
      i++;
      j++;
    } else if (i >= n) {
      raw.push({ status: "inserted", modifiedIndex: j });
      j++;
    } else if (j >= m) {
      raw.push({ status: "deleted", originalIndex: i });
      i++;
    } else {
      // Use suffix table to pick the direction that preserves more future matches
      const goDown = rdp[i + 1]![j]!; // remaining LCS if we delete a[i]
      const goRight = rdp[i]![j + 1]!; // remaining LCS if we insert b[j]
      if (goDown >= goRight) {
        raw.push({ status: "deleted", originalIndex: i });
        i++;
      } else {
        raw.push({ status: "inserted", modifiedIndex: j });
        j++;
      }
    }
  }

  // Merge adjacent deleted+inserted (or inserted+deleted) into "modified"
  return mergeAdjacentPairs(raw);
}

/**
 * Merge consecutive blocks of deletions and insertions into "modified" entries.
 * When a run of N deletions is followed by M insertions (or vice versa),
 * pair them 1:1 as "modified", with any leftovers remaining as-is.
 */
function mergeAdjacentPairs(entries: AlignmentEntry[]): AlignmentEntry[] {
  const result: AlignmentEntry[] = [];
  let idx = 0;

  while (idx < entries.length) {
    // Collect a consecutive run of deletions
    const deletions: AlignmentEntry[] = [];
    while (idx < entries.length && entries[idx]!.status === "deleted") {
      deletions.push(entries[idx]!);
      idx++;
    }

    // Collect a consecutive run of insertions immediately after
    const insertions: AlignmentEntry[] = [];
    while (idx < entries.length && entries[idx]!.status === "inserted") {
      insertions.push(entries[idx]!);
      idx++;
    }

    if (deletions.length > 0 && insertions.length > 0) {
      // Pair them 1:1 as modified
      const pairs = Math.min(deletions.length, insertions.length);
      for (let k = 0; k < pairs; k++) {
        result.push({
          status: "modified",
          originalIndex: deletions[k]!.originalIndex,
          modifiedIndex: insertions[k]!.modifiedIndex,
        });
      }
      // Leftover deletions
      for (let k = pairs; k < deletions.length; k++) {
        result.push(deletions[k]!);
      }
      // Leftover insertions
      for (let k = pairs; k < insertions.length; k++) {
        result.push(insertions[k]!);
      }
    } else {
      // Only deletions or only insertions (or neither)
      for (const d of deletions) result.push(d);
      for (const ins of insertions) result.push(ins);
    }

    // Also handle insertion-then-deletion blocks
    if (deletions.length === 0 && insertions.length === 0) {
      // Not a deletion or insertion — pass through matched/modified as-is
      if (idx < entries.length) {
        result.push(entries[idx]!);
        idx++;
      }
    }
  }

  return result;
}

/**
 * Align two arrays of measures using LCS on their content hashes.
 *
 * @param originalMeasures - Array of measures from the original document
 * @param modifiedMeasures - Array of measures from the modified document
 * @returns An array of AlignmentEntry describing the alignment
 */
export function alignMeasures(
  originalMeasures: readonly unknown[],
  modifiedMeasures: readonly unknown[],
): AlignmentEntry[] {
  const origHashes = originalMeasures.map(stableStringify);
  const modHashes = modifiedMeasures.map(stableStringify);

  const rdp = computeSuffixLCSTable(origHashes, modHashes);
  return forwardAlign(origHashes, modHashes, rdp);
}
