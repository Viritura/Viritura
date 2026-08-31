/**
 * Maps a line number in pretty-printed MNX JSON to its measure context.
 *
 * Strategy: parse the JSON, then locate each measure's line range in the
 * pretty-printed text by re-serializing individual measures and searching
 * for their unique content patterns. Works reliably with JSON.stringify(_, null, 2).
 */

export interface MeasureLocation {
  /** "parts" or "global" */
  section: "parts" | "global";
  /** Part index (0-based). Undefined for global measures. */
  partIndex?: number;
  /** Measure index (0-based) within the part or global measures array. */
  measureIndex: number;
}

/**
/**
 * Build a lookup table: line number (1-based) → MeasureLocation or null.
 * Lines outside any measure return null.
 */
export function buildLineToMeasureMap(jsonText: string): (MeasureLocation | null)[] {
  const lines = jsonText.split("\n");
  const result: (MeasureLocation | null)[] = new Array(lines.length + 1).fill(null);

  // Walk the text character-by-character, tracking JSON structure
  const lineOfChar = buildCharToLineMap(jsonText);

  const state: ParseState = {
    stack: [],
    lastKey: "",
    inString: false,
    escaped: false,
  };

  for (let pos = 0; pos < jsonText.length; pos++) {
    const ch = jsonText[pos]!;

    if (state.escaped) {
      state.escaped = false;
      continue;
    }
    if (ch === "\\" && state.inString) {
      state.escaped = true;
      continue;
    }
    if (ch === '"') {
      pos = handleQuote(jsonText, pos, state);
      continue;
    }
    if (state.inString) continue;

    if (ch === "{" || ch === "[") {
      pushFrame(state, ch === "{" ? "object" : "array");
    } else if (ch === "}" || ch === "]") {
      const lineNum = lineOfChar[pos] ?? 1;
      if (ch === "}") tryRecordMeasure(state.stack, jsonText, pos, lineNum, lineOfChar, result);
      state.stack.pop();
    }
  }

  return result;
}

interface ParseState {
  stack: Frame[];
  lastKey: string;
  inString: boolean;
  escaped: boolean;
}

/** Handle a `"` char: enter/leave a string, possibly capturing an object key. */
function handleQuote(jsonText: string, pos: number, state: ParseState): number {
  if (state.inString) {
    state.inString = false;
    return pos;
  }
  const endQuote = findClosingQuote(jsonText, pos + 1);
  if (endQuote <= pos) {
    state.inString = true;
    return pos;
  }
  const str = jsonText.substring(pos + 1, endQuote);
  const afterQuote = jsonText.substring(endQuote + 1).trimStart();
  if (afterQuote.startsWith(":")) state.lastKey = str;
  // Skip past the closing quote — we never enter string-state for this match.
  return endQuote;
}

/** Push a new object/array frame, attributing it to either the last key or the parent's array index. */
function pushFrame(state: ParseState, kind: "object" | "array"): void {
  const parent = state.stack[state.stack.length - 1];
  if (kind === "object" && parent && parent.kind === "array") {
    parent.index++;
  }
  const key = parent?.kind === "array" ? "" : state.lastKey;
  state.stack.push({ kind, key, index: -1 });
  state.lastKey = "";
}

/** If the closing brace at `pos` ends a measure object, record its line range in `result`. */
function tryRecordMeasure(
  stack: Frame[],
  jsonText: string,
  pos: number,
  endLine: number,
  lineOfChar: number[],
  result: (MeasureLocation | null)[],
): void {
  if (!isMeasureFrame(stack)) return;
  const loc = getMeasureLocation(stack);
  if (!loc) return;
  const startPos = findMatchingOpen(jsonText, pos);
  if (startPos < 0) return;
  const startLine = lineOfChar[startPos] ?? 1;
  for (let l = startLine; l <= endLine; l++) {
    result[l] = loc;
  }
}

/** Find the position of the closing quote, handling escapes. */
function findClosingQuote(text: string, startPos: number): number {
  for (let i = startPos; i < text.length; i++) {
    if (text[i] === "\\") {
      i++; // skip escaped char
      continue;
    }
    if (text[i] === '"') return i;
  }
  return -1;
}

/** Build a char position → 1-based line number map. */
function buildCharToLineMap(text: string): number[] {
  const map = new Array<number>(text.length);
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    map[i] = line;
    if (text[i] === "\n") line++;
  }
  return map;
}

/** Find the matching open brace for a close brace at position `closePos`. */
function findMatchingOpen(text: string, closePos: number): number {
  let depth = 0;
  let inStr = false;

  for (let i = closePos; i >= 0; i--) {
    const ch = text[i];

    if (ch === '"') {
      // Check if this quote is escaped by counting preceding backslashes
      let bs = 0;
      let j = i - 1;
      while (j >= 0 && text[j] === "\\") {
        bs++;
        j--;
      }
      if (bs % 2 === 0) {
        inStr = !inStr;
      }
      continue;
    }

    if (inStr) continue;

    if (ch === "}") {
      depth++;
    } else if (ch === "{") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface Frame {
  kind: "object" | "array";
  key: string;
  index: number;
}

/** Check if the current stack represents a measure object. */
function isMeasureFrame(stack: Frame[]): boolean {
  if (stack.length < 2) return false;
  const parent = stack[stack.length - 2];
  return parent !== undefined && parent.kind === "array" && parent.key === "measures";
}

/** Extract the MeasureLocation from the current stack. */
function getMeasureLocation(stack: Frame[]): MeasureLocation | null {
  // Pattern: ... / "measures" (array) / current object
  // Parent of "measures" determines section:
  //   - global.measures → section: "global"
  //   - parts[N].measures → section: "parts", partIndex: N

  const measuresFrame = stack[stack.length - 2];
  if (!measuresFrame || measuresFrame.key !== "measures") return null;

  const measureIndex = measuresFrame.index;
  if (measureIndex < 0) return null;

  // Look at grandparent context
  for (let i = stack.length - 3; i >= 0; i--) {
    const frame = stack[i];
    if (!frame) break;
    if (frame.kind === "object" && frame.key === "global") {
      return { section: "global", measureIndex };
    }
    if (frame.kind === "object" && frame.key === "") {
      // Check if parent is "parts" array
      if (i > 0) {
        const partsFrame = stack[i - 1];
        if (partsFrame && partsFrame.kind === "array" && partsFrame.key === "parts") {
          return {
            section: "parts",
            partIndex: partsFrame.index,
            measureIndex,
          };
        }
      }
    }
    if (frame.kind === "array" && frame.key === "parts") {
      return { section: "parts", partIndex: frame.index, measureIndex };
    }
    if (frame.key === "global") {
      return { section: "global", measureIndex };
    }
    break;
  }

  return null;
}

/**
 * Convenience: map a single line number to its measure location.
 */
export function lineToMeasure(map: (MeasureLocation | null)[], lineNumber: number): MeasureLocation | null {
  if (lineNumber < 1 || lineNumber >= map.length) return null;
  return map[lineNumber] ?? null;
}
