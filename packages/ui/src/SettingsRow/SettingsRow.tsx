import { useId, type ReactNode } from "react";
import styles from "./SettingsRow.module.css";

export type SettingsRowLayout = "inline" | "stacked";

/** Generated ids handed to a render-prop child so it can wire itself up. */
export interface SettingsRowIds {
  /** Put this on a single labelable control (`<Switch id>`, `<Select id>`). */
  controlId: string;
  /** Put this on a composite control's `aria-labelledby`. */
  labelId: string;
  /** Put this on the control's `aria-describedby`. `undefined` when there is no description. */
  descriptionId: string | undefined;
}

export interface SettingsRowProps {
  /** Setting name. */
  label: ReactNode;
  /** One-line explanation of what the setting does — not a restatement of
   *  the label. Announced via `aria-describedby`, not folded into the name. */
  description?: ReactNode;
  /**
   * The control. Pass a render function to receive generated ids and wire
   * label/description association; the row then renders its label as a real
   * `<label htmlFor>`. Pass a plain node when the control already carries its
   * own visible label.
   */
  children: ReactNode | ((ids: SettingsRowIds) => ReactNode);
  /**
   * `inline` (default) places the control on the right — best for compact
   * controls. `stacked` places it on its own line below, left-aligned at its
   * natural width; use it when a control is too wide to sit beside the label.
   * Neither layout stretches the control — one that should span the row
   * (a slider) declares its own width.
   */
  layout?: SettingsRowLayout;
  /** Dim the row. Does not disable the control — do that on the control. */
  disabled?: boolean;
  /** Additional className for the row container. */
  className?: string;
}

/**
 * SettingsRow — one setting: name and explanation on the left, control on
 * the right.
 *
 * Deliberately *not* a `<label>` wrapper around the whole row (unlike
 * `FormField horizontal`). Wrapping everything in a label breaks composite
 * controls — a `ButtonGroup` or `RadioGroup` has no single control to
 * associate with, and a nested `Switch`/`Checkbox` double-toggles because
 * both its own label and the outer one forward the click. It also folds the
 * description into the accessible name, making it needlessly verbose.
 *
 * Instead the label element covers only the label text, the description is a
 * sibling, and association is opt-in through the render-prop ids.
 */
export function SettingsRow({
  label,
  description,
  children,
  layout = "inline",
  disabled = false,
  className,
}: SettingsRowProps) {
  const base = useId();
  const ids: SettingsRowIds = {
    controlId: `${base}-control`,
    labelId: `${base}-label`,
    descriptionId: description !== undefined ? `${base}-description` : undefined,
  };

  const usesIds = typeof children === "function";
  const labelProps = { className: styles.labelText, id: ids.labelId };

  return (
    <div
      className={[styles.row, layout === "stacked" ? styles.stacked : styles.inline, className]
        .filter(Boolean)
        .join(" ")}
      data-disabled={disabled ? "true" : undefined}
    >
      <div className={styles.label}>
        {usesIds ? (
          <label {...labelProps} htmlFor={ids.controlId}>
            {label}
          </label>
        ) : (
          <span {...labelProps}>{label}</span>
        )}
        {description !== undefined && (
          <span className={styles.description} id={ids.descriptionId}>
            {description}
          </span>
        )}
      </div>
      <div className={styles.control}>{usesIds ? children(ids) : children}</div>
    </div>
  );
}
