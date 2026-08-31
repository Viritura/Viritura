import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./Checkbox.module.css";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Label rendered next to the checkbox. */
  label?: ReactNode;
}

/**
 * Checkbox — accessible native input styled with the glass/viridian design.
 *
 * Wraps a hidden native `<input type="checkbox">` so screen readers, keyboard
 * focus, and form submission all work without custom ARIA. The visible box
 * is a sibling `<span>` toggled via `:checked + .box` CSS.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, id, className, disabled, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-disabled={disabled ? "true" : undefined}
      htmlFor={inputId}
    >
      <input ref={ref} id={inputId} type="checkbox" className={styles.input} disabled={disabled} {...rest} />
      <span className={styles.box} aria-hidden="true">
        <svg
          className={styles.check}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      </span>
      {label !== undefined && <span className={styles.label}>{label}</span>}
    </label>
  );
});
