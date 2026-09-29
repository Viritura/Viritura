import type { TextFrame } from "@viritura/core";
import { parseTextContent } from "./textContent";
import { textFrame as validateTextFrame } from "./standaloneValidators";

type Obj = Record<string, unknown>;

/** Decode score-owned frames; malformed authored data is a parse error, even on recovery paths. */
export function parseTextFrames(raw: unknown): TextFrame[] {
  if (!Array.isArray(raw)) throw new Error("MNX: scores[].textFrames must be an array");
  const ids = new Set<string>();
  return raw.map((value: unknown, index: number): TextFrame => {
    if (!validateTextFrame(value)) {
      throw new Error(`MNX: scores[].textFrames[${index}]: invalid frame shape`);
    }
    const frame = value as Obj;
    const offset = (frame["placement"] as Obj)["offset"] as Obj;
    if (!Number.isFinite(offset["x"]) || !Number.isFinite(offset["y"])) {
      throw new Error(`MNX: scores[].textFrames[${index}]: non-finite offset`);
    }
    const id = frame["id"] as string;
    if (ids.has(id)) throw new Error(`MNX: scores[].textFrames[${index}]: duplicate id "${id}"`);
    ids.add(id);
    const rawContent = frame["content"] as unknown[];
    const content = rawContent.length === 0 ? [] : parseTextContent(rawContent);
    if (!content || content.length !== rawContent.length) {
      throw new Error(`MNX: scores[].textFrames[${index}]: invalid text content`);
    }
    return { ...frame, content } as TextFrame;
  });
}
