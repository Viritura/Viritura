import { useState, type KeyboardEvent } from "react";
import { FormInput } from "@viritura/ui";
import styles from "./TextFrames.module.css";

interface CommitNumberFieldProps {
  id: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  "aria-label"?: string;
  onCommit: (value: number) => void;
}

/**
 * Number input that commits on blur or Enter, so typing a multi-digit value
 * produces one undo step instead of one per keystroke. Invalid text reverts.
 */
export function CommitNumberField({ id, value, step = 0.5, min, max, onCommit, ...rest }: CommitNumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
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
      value={draft ?? String(value)}
      step={step}
      min={min}
      max={max}
      aria-label={rest["aria-label"]}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
