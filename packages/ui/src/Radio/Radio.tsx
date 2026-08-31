import { createContext, useContext, useId, type ReactNode } from "react";
import styles from "./Radio.module.css";

// ── RadioGroup context ─────────────────────────────────────────────
//
// The group owns the `name` attribute (so the native radio inputs are
// siblings in the same group) plus the `value` / `onChange` pair so each
// `Radio` child can render `checked` and dispatch selection events without
// the caller having to thread props through manually.

interface RadioGroupContextValue {
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps {
  /** Currently selected value. */
  value: string;
  /** Called when the user picks a different option. */
  onChange: (value: string) => void;
  /** Optional explicit `name` (auto-generated otherwise). */
  name?: string;
  /** Disables every child radio. */
  disabled?: boolean;
  /** Visual layout. `stack` (default) = column of cards; `inline` = row. */
  layout?: "stack" | "inline";
  /** Optional className applied to the wrapper. */
  className?: string;
  /** `<Radio>` children. */
  children: ReactNode;
}

export function RadioGroup({
  value,
  onChange,
  name,
  disabled,
  layout = "stack",
  className,
  children,
}: RadioGroupProps) {
  const autoName = useId();
  const groupName = name ?? autoName;
  const cls = [styles.group, layout === "inline" ? styles.groupInline : styles.groupStack, className]
    .filter(Boolean)
    .join(" ");
  return (
    <div role="radiogroup" className={cls}>
      <RadioGroupContext.Provider value={{ name: groupName, value, onChange, disabled }}>
        {children}
      </RadioGroupContext.Provider>
    </div>
  );
}

// ── Radio ──────────────────────────────────────────────────────────
//
// A single radio. Two display modes:
//   • compact (default) — small dot + inline label, suitable for grouped
//     form choices.
//   • card — rich tile with optional leading icon, bold title, and a
//     descriptive hint underneath. Use this for "where to save" /
//     "export format" pickers.

export interface RadioProps {
  /** The value sent to the group's `onChange` when this radio is picked. */
  value: string;
  /** Visible label (compact mode) or primary title (card mode). */
  label: ReactNode;
  /** Description shown under the label (card mode only). */
  description?: ReactNode;
  /** Leading icon (card mode only). */
  icon?: ReactNode;
  /** Visual variant. */
  variant?: "compact" | "card";
  /** Disables just this radio. */
  disabled?: boolean;
  /** Test id forwarded to the native input. */
  testId?: string;
  /** Optional className applied to the `<label>` wrapper. */
  className?: string;
}

export function Radio({
  value,
  label,
  description,
  icon,
  variant = "compact",
  disabled: ownDisabled,
  testId,
  className,
}: RadioProps) {
  const ctx = useContext(RadioGroupContext);
  if (!ctx) {
    throw new Error("Radio must be used inside a <RadioGroup>.");
  }
  const checked = ctx.value === value;
  const disabled = ctx.disabled || ownDisabled;
  const rootCls = [
    styles.radio,
    variant === "card" ? styles.card : styles.compact,
    checked ? styles.checked : "",
    disabled ? styles.disabled : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <label className={rootCls} data-checked={checked || undefined}>
      <input
        type="radio"
        name={ctx.name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => ctx.onChange(value)}
        className={styles.input}
        data-testid={testId}
      />
      {variant === "compact" ? (
        <>
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.label}>{label}</span>
        </>
      ) : (
        <>
          {icon !== undefined && <span className={styles.cardIcon}>{icon}</span>}
          <span className={styles.cardTextStack}>
            <span className={styles.cardTitle}>{label}</span>
            {description !== undefined && <span className={styles.cardDescription}>{description}</span>}
          </span>
          <span className={styles.cardDot} aria-hidden="true" />
        </>
      )}
    </label>
  );
}
