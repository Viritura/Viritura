/**
 * Reversible text edits between consecutive undo-history snapshots.
 *
 * The history keeps one full MNX string (the current entry) and, for every
 * other entry, the single contiguous replacement that turns its predecessor
 * into it. Because each edit stores both the removed and inserted text it can
 * be replayed in either direction, so undo/redo never has to rewrite stored
 * edits. The diff is schema-blind: it works for every write path (patches,
 * whole-document commits, repairs, imports) without an inverse-patch system.
 */

/** A single contiguous replacement: `before[start, start + removed.length)` → `inserted`. */
export interface TextEdit {
  start: number;
  removed: string;
  inserted: string;
}

const COMPARE_BLOCK = 1024;

/**
 * Copy a string so it does not retain its parent. V8 represents substrings as
 * views into the source string, so a short slice of a multi-megabyte MNX
 * document would otherwise keep the whole document alive in history.
 */
function detachString(value: string): string {
  return value.length === 0 ? "" : (JSON.parse(JSON.stringify(value)) as string);
}

/**
 * Compute the minimal single-span edit from `before` to `after` by trimming
 * the common prefix and suffix. MNX edits are usually localized (the delta
 * serializer splices unchanged measures verbatim), so the span is typically a
 * few hundred characters even on very large scores.
 */
export function diffText(before: string, after: string): TextEdit {
  const shorter = Math.min(before.length, after.length);
  // Skip matching blocks first: substring equality compares natively and is
  // an order of magnitude faster than a per-character loop on large scores.
  let prefix = 0;
  while (
    prefix + COMPARE_BLOCK <= shorter &&
    before.slice(prefix, prefix + COMPARE_BLOCK) === after.slice(prefix, prefix + COMPARE_BLOCK)
  ) {
    prefix += COMPARE_BLOCK;
  }
  while (prefix < shorter && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  const maxSuffix = shorter - prefix;
  let suffix = 0;
  while (
    suffix + COMPARE_BLOCK <= maxSuffix &&
    before.slice(before.length - suffix - COMPARE_BLOCK, before.length - suffix) ===
      after.slice(after.length - suffix - COMPARE_BLOCK, after.length - suffix)
  ) {
    suffix += COMPARE_BLOCK;
  }
  while (
    suffix < maxSuffix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++;
  }
  return {
    start: prefix,
    removed: detachString(before.slice(prefix, before.length - suffix)),
    inserted: detachString(after.slice(prefix, after.length - suffix)),
  };
}

/** Rebuild the successor text from its predecessor. */
export function applyTextEdit(before: string, edit: TextEdit): string {
  return before.slice(0, edit.start) + edit.inserted + before.slice(edit.start + edit.removed.length);
}

/** Rebuild the predecessor text from its successor. */
export function revertTextEdit(after: string, edit: TextEdit): string {
  return after.slice(0, edit.start) + edit.removed + after.slice(edit.start + edit.inserted.length);
}

/**
 * Piece list used when replaying many edits in one jump. Replacing spans in
 * a list of string pieces avoids re-copying the whole document for every
 * step; the document is flattened exactly once in `toString()`.
 */
export class PieceText {
  private pieces: string[];

  constructor(text: string) {
    this.pieces = text.length > 0 ? [text] : [];
  }

  replace(start: number, removeLength: number, insert: string): void {
    const end = start + removeLength;
    const next: string[] = [];
    let pos = 0;
    let inserted = false;
    for (const piece of this.pieces) {
      const pieceStart = pos;
      const pieceEnd = pos + piece.length;
      pos = pieceEnd;
      if (pieceEnd <= start || (inserted && pieceStart >= end)) {
        next.push(piece);
        continue;
      }
      if (pieceStart < start) next.push(piece.slice(0, start - pieceStart));
      if (!inserted) {
        if (insert.length > 0) next.push(insert);
        inserted = true;
      }
      if (pieceEnd > end) next.push(piece.slice(Math.max(0, end - pieceStart)));
    }
    if (!inserted && insert.length > 0) next.push(insert);
    this.pieces = next;
  }

  apply(edit: TextEdit): void {
    this.replace(edit.start, edit.removed.length, edit.inserted);
  }

  revert(edit: TextEdit): void {
    this.replace(edit.start, edit.inserted.length, edit.removed);
  }

  toString(): string {
    return this.pieces.join("");
  }
}
