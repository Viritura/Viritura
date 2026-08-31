/**
 * StatusSelect — custom dropdown for the dark "status pill" surfaces.
 *
 * Replaces native <select> on the editor's Write StatusBar and the
 * Engrave/Publish PreviewStatusBar so the trigger matches the pill
 * aesthetic and the chevron stays put (native selects render a
 * platform chevron that drifts on Windows/Linux). Popover opens
 * upward to float above the status bar.
 *
 * This is a dark-pill primitive; for general light-surface dropdowns
 * use `Select` / `Menu` instead.
 */
import { useEffect, useRef, useState } from "react";
import styles from "./StatusSelect.module.css";
import { withTooltip } from "../Tooltip/withTooltip";

export interface StatusSelectOption {
  value: string;
  label: string;
}

export interface StatusSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<StatusSelectOption>;
  ariaLabel: string;
  /** Tooltip text. Rendered through `<Tooltip>` (not the native browser title). */
  tooltip?: string;
}

export function StatusSelect({ value, onChange, options, ariaLabel, tooltip }: StatusSelectProps) {
  const tip = tooltip ?? ariaLabel;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {withTooltip(
        <button
          type="button"
          className={styles.trigger}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
        >
          <span className={styles.label}>{current?.label ?? value}</span>
          <svg
            className={styles.chevron}
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="3,4.5 6,7.5 9,4.5" />
          </svg>
        </button>,
        tip,
      )}
      {open && (
        <div className={styles.popup} role="listbox" aria-label={ariaLabel}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`${styles.option} ${selected ? styles.optionSelected : ""}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
