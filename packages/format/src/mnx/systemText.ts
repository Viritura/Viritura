import type { SystemText } from "@viritura/core";
import { systemText as validateSystemText } from "./standaloneValidators";
import { parseTextContent } from "./textContent";
import { parseStaffTextFramePresentation } from "./staffTextFrame";

export function parseSystemText(raw: unknown): SystemText[] {
  if (!Array.isArray(raw)) throw new Error("MNX: systemText must be an array.");
  const ids = new Set<string>();
  return raw.map((value: unknown, index) => {
    const error = (reason: string) => new Error(`MNX: systemText[${index}]: ${reason}`);
    if (!validateSystemText(value)) throw error("invalid system text");
    const text = value as SystemText;
    if (ids.has(text.id)) throw error(`duplicate id "${text.id}"`);
    ids.add(text.id);
    if (
      !text.position.fraction.every(Number.isFinite) ||
      text.position.fraction[0] < 0 ||
      text.position.fraction[1] <= 0 ||
      text.manualOffset?.some((offset) => !Number.isFinite(offset))
    ) {
      throw error("invalid rhythmic position or offset");
    }
    const content = parseTextContent(text.text);
    if (!content?.length) throw error("text content is empty");
    let frame = text.frame;
    if (frame !== undefined) {
      try {
        frame = parseStaffTextFramePresentation(frame);
      } catch (cause) {
        throw error(`frame: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    return {
      ...text,
      text: content,
      ...(frame === undefined ? {} : { frame }),
    };
  });
}
