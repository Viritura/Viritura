import { Button, Checkbox, FormField } from "@viritura/ui";
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
      <Checkbox
        label="Wrap to frame width"
        checked={frame.width !== undefined}
        onChange={(event) => {
          const rest = { ...frame };
          delete rest.width;
          onChange(event.target.checked ? { ...frame, width: { unit: "staffSpaces", value: 20 } } : rest);
        }}
      />
      {frame.width && (
        <FormField label="Width (sp)" htmlFor={`${id}-width`}>
          <CommitNumberField
            id={`${id}-width`}
            value={frame.width.value}
            min={0.1}
            step={0.5}
            onCommit={(width) => onChange({ ...frame, width: { unit: "staffSpaces", value: width } })}
          />
        </FormField>
      )}
      <p className={styles.help}>
        Without a width, text uses its natural width. Height grows automatically; authored line breaks are kept. The
        frame stays attached to this staff and musical position.
      </p>
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
