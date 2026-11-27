import { useId, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Checkbox } from "../Checkbox/Checkbox";
import { SelectTrigger } from "../Select";
import styles from "./MultiSelectPopover.module.css";

export interface MultiSelectPopoverOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface MultiSelectPopoverGroup {
  readonly label: string;
  readonly options: readonly MultiSelectPopoverOption[];
}

export interface MultiSelectPopoverProps {
  readonly value: readonly string[];
  readonly groups: readonly MultiSelectPopoverGroup[];
  readonly onValueChange: (value: string[]) => void;
  readonly ariaLabel: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

export function MultiSelectPopover({
  value,
  groups,
  onValueChange,
  ariaLabel,
  placeholder = "Choose options",
  disabled = false,
}: MultiSelectPopoverProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const options = new Map(groups.flatMap((group) => group.options.map((option) => [option.value, option] as const)));
  const selected = [...new Set(value)].flatMap((item) => {
    const option = options.get(item);
    return option ? [option] : [];
  });

  function setChecked(optionValue: string, checked: boolean) {
    const next = new Set(value);
    if (checked) next.add(optionValue);
    else next.delete(optionValue);
    onValueChange([...next]);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <SelectTrigger
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          fullWidth
        >
          <span className={styles.summary}>
            <span className={styles.summaryLabel}>{selected[0]?.label ?? placeholder}</span>
            {selected.length > 1 && <span className={styles.summaryCount}>{` (+${selected.length - 1})`}</span>}
          </span>
        </SelectTrigger>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          id={listId}
          aria-label={ariaLabel}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={styles.content}
        >
          {groups.map((group, groupIndex) => {
            if (!group.options.length) return null;
            return (
              <fieldset className={styles.group} key={`${group.label}-${groupIndex}`}>
                <legend className={styles.heading}>{group.label}</legend>
                <div className={styles.options}>
                  {group.options.map((option) => (
                    <Checkbox
                      key={option.value}
                      label={option.label}
                      checked={value.includes(option.value)}
                      disabled={option.disabled}
                      onChange={(event) => setChecked(option.value, event.currentTarget.checked)}
                    />
                  ))}
                </div>
              </fieldset>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
