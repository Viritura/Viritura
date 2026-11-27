import type { Root as RawScore, Staff, StaffGroup } from "@viritura/core/raw";
import type { RawScoreValidationError } from "./validator";

export function validateLabelReferences(score: RawScore): RawScoreValidationError[] {
  const errors: RawScoreValidationError[] = [];
  const partIds = new Set(score.parts.flatMap((part) => (part.id === undefined ? [] : [part.id])));

  function check(reference: Staff["labelRef"], pointer: string): void {
    if (reference?.target !== undefined && !partIds.has(reference.target)) {
      errors.push({
        pointer: `${pointer}/target`,
        message: `must reference a part ('${reference.target}' was not found)`,
        keyword: "reference",
      });
    }
  }

  function visit(content: (Staff | StaffGroup)[], pointer: string): void {
    content.forEach((item, index) => {
      const itemPointer = `${pointer}/${index}`;
      check(item.labelRef, `${itemPointer}/labelRef`);
      if (item.type === "group") {
        visit(item.content, `${itemPointer}/content`);
      } else {
        item.sources.forEach((source, sourceIndex) => {
          check(source.labelRef, `${itemPointer}/sources/${sourceIndex}/labelRef`);
        });
      }
    });
  }

  score.layouts?.forEach((layout, index) => visit(layout.content, `/layouts/${index}/content`));
  return errors;
}
