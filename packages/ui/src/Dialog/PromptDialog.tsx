import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Dialog, DialogTitle, DialogBody, DialogActions, DialogCancelButton, DialogPrimaryButton } from "./Dialog";
import { FormInput } from "../FormField/FormField";

const DESCRIPTION_STYLE: CSSProperties = {
  margin: "0 0 0.75rem 0",
  fontSize: "var(--type-small-size)",
  color: "var(--text-muted)",
};

export interface PromptDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog is dismissed (cancel, escape, or backdrop click). */
  onClose: () => void;
  /** Called with the entered value when the user confirms. */
  /** Return false to keep the dialog open after validation fails. */
  onSubmit: (value: string) => boolean | void;
  /** Dialog title (e.g. "Tempo (BPM)"). */
  title: string;
  /** Optional description shown above the input. */
  description?: string;
  /** Input label (used as `aria-label` on the input). Defaults to `title`. */
  label?: string;
  /** Initial value for the input. */
  initialValue?: string;
  /** Placeholder text. */
  placeholder?: string;
  /** Input type — `"text"` or `"number"`. Defaults to `"text"`. */
  type?: "text" | "number";
  /** Confirm button label. Defaults to `"OK"`. */
  confirmLabel?: string;
  /** Allow submitting with an empty value (e.g. to clear the field). Defaults to `true`. */
  allowEmpty?: boolean;
}

/**
 * Reusable single-line prompt dialog — a styled replacement for
 * `window.prompt()` that matches the rest of the dialog system.
 * The input auto-focuses on open and submits on Enter.
 */
export function PromptDialog({
  open,
  onClose,
  onSubmit,
  title,
  description,
  label,
  initialValue = "",
  placeholder,
  type = "text",
  confirmLabel = "OK",
  allowEmpty = true,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the value whenever the dialog re-opens.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setValue(initialValue);
      // Defer focus/select so the input is mounted.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, initialValue]);

  const canSubmit = allowEmpty || value.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (onSubmit(value) !== false) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogBody>
        {description && <p style={DESCRIPTION_STYLE}>{description}</p>}
        <FormInput
          ref={inputRef}
          large
          type={type}
          value={value}
          placeholder={placeholder ?? ""}
          aria-label={label ?? title}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
      </DialogBody>
      <DialogActions>
        <DialogCancelButton />
        <DialogPrimaryButton onClick={handleSubmit} disabled={!canSubmit}>
          {confirmLabel}
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
