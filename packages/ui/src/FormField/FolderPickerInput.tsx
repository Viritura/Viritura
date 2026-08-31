import { forwardRef, type ButtonHTMLAttributes } from "react";
import { FolderOpen } from "lucide-react";
import styles from "./FolderPickerInput.module.css";

export interface FolderPickerInputProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onChange" | "type" | "value"
> {
  /** Selected folder display name or path. */
  value?: string | null;
  /** Text shown before a folder is selected. */
  placeholder?: string;
  /** Use the larger dialog-size variant. */
  large?: boolean;
  /** Marks folder selection as required for the surrounding form. */
  required?: boolean;
}

/**
 * Input-like folder selector. Filesystem APIs stay with the consumer; this
 * primitive owns only field appearance, focus, and selected-value display.
 */
export const FolderPickerInput = forwardRef<HTMLButtonElement, FolderPickerInputProps>(function FolderPickerInput(
  { value, placeholder = "Choose a folder…", large = false, required = false, disabled, className, ...props },
  ref,
) {
  const selected = Boolean(value);
  return (
    <button
      ref={ref}
      type="button"
      className={[styles.input, large ? styles.large : "", className].filter(Boolean).join(" ")}
      aria-required={required || undefined}
      disabled={disabled}
      {...props}
    >
      <FolderOpen size={16} aria-hidden="true" className={styles.icon} />
      <span className={selected ? styles.value : styles.placeholder}>{value || placeholder}</span>
      <span className={styles.action}>{selected ? "Change…" : "Choose…"}</span>
    </button>
  );
});
