import { Fragment, type ReactNode } from "react";
import styles from "./ButtonGroup.module.css";
import { BravuraGlyph } from "../BravuraGlyph";
import { useRadioGroupNavigation } from "../RadioGroup";
import { withTooltip } from "../Tooltip/withTooltip";

export interface ButtonGroupOption<T extends string = string> {
  value: T;
  /** Display content. Strings render as-is; pass ReactNode for icons. */
  label: ReactNode;
  /** Tooltip text (also used as aria-label override). Rendered through `<Tooltip>`. */
  tooltip?: string;
  /** When true AND `label` is a string, render via `BravuraGlyph` for
   *  canvas-measured SMuFL glyph centering. Ignored for non-string labels. */
  useBravura?: boolean;
}

export interface ButtonGroupProps<T extends string = string> {
  /** ID applied to the radiogroup for external associations. */
  id?: string;
  /** Available options */
  options: ButtonGroupOption<T>[];
  /** Currently selected value */
  value: T;
  /** Called when user selects an option */
  onChange: (value: T) => void;
  /** Disable every option in the group. */
  disabled?: boolean;
  /** Accessible name for the group when no external label names it. */
  ariaLabel?: string;
  /** Id of an element naming this group (e.g. a `SettingsRow` label). A
   *  `radiogroup` with no accessible name is announced as an unnamed group,
   *  so one of `ariaLabel` / `ariaLabelledBy` should always be supplied. */
  ariaLabelledBy?: string;
  /** Id of an element describing this group (e.g. a `SettingsRow` description). */
  ariaDescribedBy?: string;
  /** Standard ARIA aliases injected by FormField. */
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true";
  /** Additional className */
  className?: string;
  /** Test ID applied to the radiogroup. */
  "data-testid"?: string;
}

/**
 * Segmented-pill single-select control. Renders a row of radio buttons
 * wrapped in a glass pill — distinct from a row of standalone `Button`s
 * (the segmented chrome is the whole point).
 *
 * Each option's label may be a plain string, a React node (icon), or a
 * SMuFL glyph string with `useBravura: true`. The Bravura branch goes
 * through the same `<BravuraGlyph>` centering used by `Button`, so glyph
 * alignment is consistent across the design system.
 *
 * Renamed from the former `ToggleGroup` to make the family relationship
 * with `Button` / `IconButton` / `LongPressButton` explicit.
 */
export function ButtonGroup<T extends string = string>({
  id,
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  "aria-labelledby": ariaLabelledByAttribute,
  "aria-describedby": ariaDescribedByAttribute,
  "aria-invalid": ariaInvalid,
  className,
  "data-testid": testId,
}: ButtonGroupProps<T>) {
  const { optionRef, optionTabIndex, onOptionKeyDown } = useRadioGroupNavigation(options, value, onChange, disabled);
  return (
    <div
      id={id}
      className={`${styles.group} ${className ?? ""}`}
      role="radiogroup"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledByAttribute ?? ariaLabelledBy}
      aria-describedby={ariaDescribedByAttribute ?? ariaDescribedBy}
      aria-invalid={ariaInvalid}
      aria-disabled={disabled}
      data-testid={testId}
    >
      {options.map((opt, index) => {
        const selected = opt.value === value;
        const isBravura = opt.useBravura && typeof opt.label === "string";
        return (
          <Fragment key={opt.value}>
            {withTooltip(
              <button
                type="button"
                ref={optionRef(index)}
                role="radio"
                aria-checked={selected}
                aria-label={opt.tooltip}
                disabled={disabled}
                tabIndex={optionTabIndex(index)}
                className={`${styles.option} ${selected ? styles.active : ""} ${isBravura ? styles.bravura : ""}`.trim()}
                onClick={() => onChange(opt.value)}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
              >
                {isBravura ? <BravuraGlyph>{opt.label as string}</BravuraGlyph> : opt.label}
              </button>,
              opt.tooltip,
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
