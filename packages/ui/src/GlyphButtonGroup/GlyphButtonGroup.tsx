import { Fragment } from "react";
import { useRadioGroupNavigation } from "../RadioGroup";
import { withTooltip } from "../Tooltip/withTooltip";
import styles from "./GlyphButtonGroup.module.css";

export interface GlyphButtonGroupOption<T extends string = string> {
  readonly value: T;
  readonly glyph: string;
  readonly label: string;
}

export interface GlyphButtonGroupProps<T extends string = string> {
  readonly options: readonly GlyphButtonGroupOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly "data-testid"?: string;
}

/** Square single-select swatches for Bravura/SMuFL glyph choices. */
export function GlyphButtonGroup<T extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  "data-testid": testId,
}: GlyphButtonGroupProps<T>) {
  const { optionRef, optionTabIndex, onOptionKeyDown } = useRadioGroupNavigation(options, value, onChange, disabled);
  return (
    <div
      className={styles.group}
      role="radiogroup"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      data-testid={testId}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Fragment key={option.value}>
            {withTooltip(
              <button
                type="button"
                ref={optionRef(index)}
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                disabled={disabled}
                tabIndex={optionTabIndex(index)}
                className={selected ? styles.optionActive : styles.option}
                onClick={() => onChange(option.value)}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
              >
                <span className={styles.glyph}>{option.glyph}</span>
              </button>,
              option.label,
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
