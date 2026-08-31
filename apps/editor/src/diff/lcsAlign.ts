/**
 * Longest Common Subsequence (LCS) alignment used by the semantic-diff tree.
 * Extracted from semanticDiff.ts to keep that file under the file-size cap.
 */

export interface AlignmentEntry {
  type: "match" | "added" | "removed";
  originalIndex?: number;
  modifiedIndex?: number;
}

/**
 * Compute raw LCS-based alignment of two arrays using content hashes.
 * Returns an ordered list of alignment entries (exact matches only).
 */
export function lcsAlign<T>(original: T[], modified: T[], hash: (item: T) => string): AlignmentEntry[] {
  const origHashes = original.map(hash);
  const modHashes = modified.map(hash);

  const n = origHashes.length;
  const m = modHashes.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (origHashes[i - 1] === modHashes[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to find alignment
  let i = n;
  let j = m;

  const backtrack: AlignmentEntry[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origHashes[i - 1] === modHashes[j - 1]) {
      backtrack.push({
        type: "match",
        originalIndex: i - 1,
        modifiedIndex: j - 1,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      backtrack.push({ type: "added", modifiedIndex: j - 1 });
      j--;
    } else {
      backtrack.push({ type: "removed", originalIndex: i - 1 });
      i--;
    }
  }

  // Reverse to get forward order
  const result: AlignmentEntry[] = [];
  for (let k = backtrack.length - 1; k >= 0; k--) {
    result.push(backtrack[k]!);
  }

  return result;
}

/**
 * Refine LCS alignment by pairing adjacent removed+added entries as matches.
 * This allows modified items to be compared in detail rather than shown as
 * a removal + addition.
 */
export function lcsAlignWithModifications<T>(
  original: T[],
  modified: T[],
  hash: (item: T) => string,
): AlignmentEntry[] {
  const raw = lcsAlign(original, modified, hash);
  const result: AlignmentEntry[] = [];
  let idx = 0;

  while (idx < raw.length) {
    const entry = raw[idx]!;
    if (entry.type === "match") {
      result.push(entry);
      idx++;
    } else {
      // Collect consecutive removed and added entries
      const removed: number[] = [];
      const added: number[] = [];
      while (idx < raw.length && raw[idx]!.type !== "match") {
        const e = raw[idx]!;
        if (e.type === "removed" && e.originalIndex !== undefined) removed.push(e.originalIndex);
        if (e.type === "added" && e.modifiedIndex !== undefined) added.push(e.modifiedIndex);
        idx++;
      }
      // Pair up as matches (for modification comparison)
      const pairs = Math.min(removed.length, added.length);
      for (let p = 0; p < pairs; p++) {
        result.push({
          type: "match",
          originalIndex: removed[p]!,
          modifiedIndex: added[p]!,
        });
      }
      // Remaining unpaired items
      for (let p = pairs; p < removed.length; p++) {
        result.push({ type: "removed", originalIndex: removed[p]! });
      }
      for (let p = pairs; p < added.length; p++) {
        result.push({ type: "added", modifiedIndex: added[p]! });
      }
    }
  }

  return result;
}
