import * as RadixSelect from "@radix-ui/react-select";
import { ChevronDown, Check } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./Select.module.css";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /** Optional leading icon rendered next to the label (in trigger and items). */
  readonly icon?: ReactNode;
  /** Disable selection for this option (e.g. "coming soon" placeholders). */
  readonly disabled?: boolean;
}

export interface SelectProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly disabled?: boolean;
  readonly placeholder?: string;
  /** Visual size — `md` (default, inspector/toolbar) or `lg` (dialogs / FormField stacks). */
  readonly size?: "md" | "lg";
  /** Accessible name for the select trigger when no associated label is available. */
  readonly "aria-label"?: string;
  /** Id applied to the trigger, so an external `<label htmlFor>` can name it. */
  readonly id?: string;
  /** Id of an element naming this select (e.g. a `SettingsRow` label). */
  readonly "aria-labelledby"?: string;
  /** Id of an element describing this select (e.g. a `SettingsRow` description). */
  readonly "aria-describedby"?: string;
  readonly "data-testid"?: string;
  readonly className?: string;
}

// Radix Select disallows empty-string item values, so we map "" ↔ sentinel.
const EMPTY_SENTINEL = "__empty__";
function toRadix(v: string): string {
  return v === "" ? EMPTY_SENTINEL : v;
}
function fromRadix(v: string): string {
  return v === EMPTY_SENTINEL ? "" : v;
}

export function Select({
  value,
  onValueChange,
  options,
  disabled,
  placeholder = "Select…",
  size = "md",
  "aria-label": ariaLabel,
  id,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "data-testid": testId,
  className,
}: SelectProps) {
  const selected = options.find((o) => o.value === value);
  const triggerClass = [styles.trigger, size === "lg" ? styles.triggerLg : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <RadixSelect.Root
      value={toRadix(value)}
      onValueChange={(v) => onValueChange(fromRadix(v))}
      disabled={disabled ?? false}
    >
      <RadixSelect.Trigger
        className={triggerClass}
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        data-testid={testId}
      >
        <span className={styles.triggerInner}>
          {selected?.icon ? <span className={styles.triggerIcon}>{selected.icon}</span> : null}
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon className={styles.icon}>
          <ChevronDown size={12} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className={styles.content} position="popper" sideOffset={4}>
          <RadixSelect.Viewport className={styles.viewport}>
            {options.map((opt) => (
              <RadixSelect.Item
                key={opt.value}
                value={toRadix(opt.value)}
                className={styles.item}
                disabled={opt.disabled}
              >
                {opt.icon ? <span className={styles.itemIcon}>{opt.icon}</span> : null}
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className={styles.indicator}>
                  <Check size={12} />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
