import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import styles from "./SearchInput.module.css";

export type SearchInputSize = "sm" | "md";

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "size" | "value" | "onChange"
> {
  /** Current query text. */
  value: string;
  /** Called with the next query text. Also fires with "" when cleared. */
  onValueChange: (value: string) => void;
  /** Placeholder text. Defaults to "Search". */
  placeholder?: string;
  /** Control height. `md` (default) for dialogs, `sm` for panel headers. */
  size?: SearchInputSize;
  /** Accessible name. Defaults to the placeholder. */
  ariaLabel?: string;
  /**
   * Clear the field when Escape is pressed. Off by default.
   *
   * Only enable this outside a dialog or popover. Radix dismissable layers
   * listen for Escape on `document` in the capture phase, so they dismiss
   * before this bubble-phase handler ever runs — the field would clear *and*
   * the dialog would close. Inside a `Dialog`, arbitrate with its
   * `onEscapeKeyDown` prop instead.
   */
  clearOnEscape?: boolean;
}

/**
 * SearchInput — a filter field with a leading icon and a clear affordance.
 *
 * `type="search"` (rather than `type="text"`) so assistive tech announces the
 * role and mobile keyboards offer a search key; the browser's own clear widget
 * is suppressed in CSS in favour of a themed button we control.
 *
 * Escape clears the field while keeping focus when `clearOnEscape` is set —
 * the expected gesture for a filter above a list, but off by default because
 * dismissable layers claim Escape first (see `clearOnEscape`).
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onValueChange,
    placeholder = "Search",
    size = "md",
    ariaLabel,
    clearOnEscape = false,
    id,
    className,
    disabled,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const iconSize = size === "sm" ? 13 : 14;

  return (
    <div
      className={[styles.root, size === "sm" ? styles.sm : styles.md, className].filter(Boolean).join(" ")}
      data-disabled={disabled ? "true" : undefined}
    >
      <Search className={styles.icon} size={iconSize} aria-hidden />
      <input
        ref={ref}
        id={inputId}
        type="search"
        className={styles.input}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        disabled={disabled}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (clearOnEscape && event.key === "Escape" && value !== "") {
            // Stop an ancestor from also treating this Escape as a dismissal.
            // Only effective against bubble-phase listeners; see clearOnEscape.
            event.stopPropagation();
            onValueChange("");
          }
          onKeyDown?.(event);
        }}
        {...rest}
      />
      {value !== "" && !disabled && (
        <button type="button" className={styles.clear} aria-label="Clear search" onClick={() => onValueChange("")}>
          <X size={iconSize} aria-hidden />
        </button>
      )}
    </div>
  );
});
