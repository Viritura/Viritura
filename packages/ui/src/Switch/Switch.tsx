import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./Switch.module.css";

export type SwitchSize = "sm" | "md";

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size" | "onChange"> {
  /** Whether the switch is on. */
  checked: boolean;
  /** Called with the next checked state. */
  onCheckedChange: (checked: boolean) => void;
  /** Optional label rendered after the track. Omit when an external
   *  `<label htmlFor>` (e.g. a SettingsRow) already names the control. */
  label?: ReactNode;
  /** Track size. `md` (default) for dialogs, `sm` for dense panels. */
  size?: SwitchSize;
}

/**
 * Switch — an instant-apply boolean toggle.
 *
 * Use this instead of `Checkbox` when flipping the control takes effect
 * immediately. A checkbox reads as "staged, pending a confirm button"; a
 * switch reads as "this is on now". Settings surfaces that apply live should
 * prefer `Switch`; forms with an explicit submit should prefer `Checkbox`.
 *
 * Backed by a real `<input type="checkbox">` (visually hidden) so keyboard
 * activation, focus, and form semantics work without custom ARIA.
 * `role="switch"` upgrades the screen-reader announcement from "checkbox".
 */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, size = "md", id, className, disabled, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <span
      className={[styles.root, size === "sm" ? styles.sm : styles.md, className].filter(Boolean).join(" ")}
      data-disabled={disabled ? "true" : undefined}
    >
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        role="switch"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
        {...rest}
      />
      {/* The track must immediately follow the input so `:checked + .track`
          can paint it, and must stay non-interactive — the <label> owns
          activation, and a clickable track would double-toggle. */}
      <label className={styles.track} htmlFor={inputId} aria-hidden="true">
        <span className={styles.thumb} />
      </label>
      {label !== undefined && (
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
      )}
    </span>
  );
});
