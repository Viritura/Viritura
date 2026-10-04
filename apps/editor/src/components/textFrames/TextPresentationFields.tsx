import { ButtonGroup, Checkbox, FormField } from "@viritura/ui";
import type { TextFramePresentation } from "@viritura/core";
import { CommitNumberField } from "./CommitNumberField";
import styles from "./TextFrames.module.css";

const ALIGNMENTS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
] satisfies { value: NonNullable<TextFramePresentation["horizontalAlignment"]>; label: string }[];
const JUSTIFICATIONS = [...ALIGNMENTS, { value: "justify", label: "Justify" }] satisfies {
  value: NonNullable<TextFramePresentation["paragraphJustification"]>;
  label: string;
}[];
const BORDERS = [
  { value: "none", label: "None" },
  { value: "solid", label: "Solid" },
] satisfies { value: NonNullable<TextFramePresentation["border"]>; label: string }[];

interface TextPresentationFieldsProps {
  id: string;
  value: TextFramePresentation;
  defaultAlignment: NonNullable<TextFramePresentation["horizontalAlignment"]>;
  automaticAlignment?: boolean;
  onChange: (value: Partial<Omit<TextFramePresentation, "width">>) => void;
}

export function TextPresentationFields({
  id,
  value,
  defaultAlignment,
  automaticAlignment = false,
  onChange,
}: TextPresentationFieldsProps) {
  return (
    <div className={styles.group}>
      <p className={styles.groupTitle}>Text layout</p>
      <FormField label="Frame alignment">
        <ButtonGroup
          ariaLabel="Frame alignment"
          options={automaticAlignment ? [{ value: "auto", label: "Auto" }, ...ALIGNMENTS] : ALIGNMENTS}
          value={value.horizontalAlignment ?? (automaticAlignment ? "auto" : defaultAlignment)}
          onChange={(horizontalAlignment: "auto" | NonNullable<TextFramePresentation["horizontalAlignment"]>) =>
            onChange({ horizontalAlignment: horizontalAlignment === "auto" ? undefined : horizontalAlignment })
          }
        />
      </FormField>
      <FormField label="Paragraph justification">
        <ButtonGroup
          ariaLabel="Paragraph justification"
          options={JUSTIFICATIONS}
          value={value.paragraphJustification ?? "left"}
          onChange={(paragraphJustification) => onChange({ paragraphJustification })}
        />
      </FormField>
      <div className={styles.fieldRow}>
        <FormField label="Padding (sp)" htmlFor={`${id}-padding`}>
          <CommitNumberField
            id={`${id}-padding`}
            value={value.padding ?? 0}
            min={0}
            onCommit={(padding) => onChange({ padding })}
          />
        </FormField>
        <FormField label="Border">
          <ButtonGroup
            ariaLabel="Border"
            options={BORDERS}
            value={value.border ?? "none"}
            onChange={(border) => onChange({ border })}
          />
        </FormField>
      </div>
      <Checkbox
        label="Erase background"
        checked={value.eraseBackground ?? false}
        onChange={(event) => onChange({ eraseBackground: event.target.checked })}
      />
    </div>
  );
}
