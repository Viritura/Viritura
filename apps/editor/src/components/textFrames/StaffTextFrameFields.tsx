import { Button, FormField } from "@viritura/ui";
import type { StaffTextFramePresentation } from "@viritura/core";
import { CommitNumberField } from "./CommitNumberField";
import { TextPresentationFields } from "./TextPresentationFields";
import styles from "./TextFrames.module.css";

interface StaffTextFrameFieldsProps {
  id: string;
  value: StaffTextFramePresentation | undefined;
  onChange: (value: StaffTextFramePresentation | undefined) => void;
}

export function StaffTextFrameFields({ id, value, onChange }: StaffTextFrameFieldsProps) {
  const frame = value ?? {};
  return (
    <section className={styles.group} aria-label="Staff text frame">
      <p className={styles.groupTitle}>Frame</p>
      <FormField
        label="Fixed width (sp)"
        htmlFor={`${id}-width`}
        message="Empty = auto width. Set a width to wrap text."
      >
        <CommitNumberField
          id={`${id}-width`}
          value={frame.width?.value}
          placeholder="Auto"
          min={0.1}
          step={0.5}
          onCommit={(width) => onChange({ ...frame, width: { unit: "staffSpaces", value: width } })}
          onClear={() => {
            const { width: _width, ...rest } = frame;
            onChange(rest);
          }}
        />
      </FormField>
      <TextPresentationFields
        id={id}
        value={frame}
        defaultAlignment="left"
        automaticAlignment
        onChange={(change) => onChange({ ...frame, ...change })}
      />
      {value && (
        <Button size="sm" onClick={() => onChange(undefined)}>
          Reset frame
        </Button>
      )}
    </section>
  );
}
