import type { Root as RawScore, SequenceContent } from "@viritura/core/raw";
import type { RawScoreValidationError } from "./validator";

function pointerToken(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function validateLyricLines(score: RawScore): RawScoreValidationError[] {
  const errors: RawScoreValidationError[] = [];
  const lyrics = score.global.lyrics;
  const orderedIds = new Set(lyrics?.lineOrder ?? []);
  let hasEventLyrics = false;

  for (const id of Object.keys(lyrics?.lineMetadata ?? {})) {
    if (!orderedIds.has(id)) {
      errors.push({
        pointer: `/global/lyrics/lineMetadata/${pointerToken(id)}`,
        message: "must be listed in global.lyrics.lineOrder",
        keyword: "reference",
      });
    }
  }

  function visit(content: SequenceContent, pointer: string): void {
    content.forEach((item, index) => {
      const itemPointer = `${pointer}/${index}`;
      if ("lyrics" in item && item.lyrics !== undefined) {
        hasEventLyrics = true;
        if (lyrics) {
          for (const id of Object.keys(item.lyrics.lines ?? {})) {
            if (!orderedIds.has(id)) {
              errors.push({
                pointer: `${itemPointer}/lyrics/lines/${pointerToken(id)}`,
                message: "must be listed in global.lyrics.lineOrder",
                keyword: "reference",
              });
            }
          }
        }
      }
      if ("content" in item) visit(item.content, `${itemPointer}/content`);
    });
  }

  score.parts.forEach((part, partIndex) => {
    part.measures.forEach((measure, measureIndex) => {
      measure.sequences.forEach((sequence, sequenceIndex) => {
        visit(sequence.content, `/parts/${partIndex}/measures/${measureIndex}/sequences/${sequenceIndex}/content`);
      });
    });
  });
  if (hasEventLyrics && !lyrics) {
    errors.push({
      pointer: "/global/lyrics",
      message: "is required when any event has lyrics",
      keyword: "required",
    });
  }
  return errors;
}
