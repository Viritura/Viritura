import { useState, type KeyboardEvent } from "react";
import { FormInput, type FormInputProps } from "@viritura/ui";
import styles from "./TextFrames.module.css";

interface CommitNumberFieldProps extends Pick<
  FormInputProps,
  "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"
> {
  id: string;
  value: number | undefined;
  placeholder?: string;
  onClear?: () => void;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}

/**
 * Number input that commits on blur or Enter, so typing a multi-digit value
 * produces one undo step instead of one per keystroke. Invalid text reverts.
 */
export function CommitNumberField({
  id,
  value,
  step = 0.5,
  min,
  max,
  onCommit,
  onClear,
  placeholder,
  ...rest
}: CommitNumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (draft.trim() === "" && onClear) {
      if (value !== undefined) onClear();
      return;
    }
    if (draft.trim() !== "" && Number.isFinite(parsed)) {
      const bounded = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
      if (bounded !== value) onCommit(bounded);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
    if (event.key === "Escape") setDraft(null);
  };
  return (
    <FormInput
      id={id}
      type="number"
      className={styles.numberInput}
      value={draft ?? (value === undefined ? "" : String(value))}
      placeholder={placeholder}
      step={step}
      min={min}
      max={max}
      {...rest}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
