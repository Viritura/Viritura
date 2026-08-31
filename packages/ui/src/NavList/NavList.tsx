import { useCallback, useId, type KeyboardEvent } from "react";
import { ListRow } from "../ListRow/ListRow";
import { SectionLabel } from "../SectionLabel/SectionLabel";
import { nextNavItemId } from "./navKeyboard";
import type { NavListGroup } from "./types";
import styles from "./NavList.module.css";

export interface NavListProps {
  /** Grouped rows, in display order. */
  groups: readonly NavListGroup[];
  /** Currently selected item id. */
  value: string;
  /** Called with the newly selected item id. */
  onChange: (id: string) => void;
  /** Accessible name for the list (e.g. "Settings categories"). */
  ariaLabel: string;
  /**
   * When set, rows become `role="tab"` and each row's `aria-controls` points
   * at `` `${panelIdPrefix}-${item.id}` ``. Use for a master–detail pane so
   * the detail region is announced as the selected tab's panel. Omit for
   * plain navigation lists.
   */
  panelIdPrefix?: string;
  /** Additional className for the container. */
  className?: string;
}

/**
 * NavList — a grouped vertical nav rail with roving-tabindex keyboard
 * navigation.
 *
 * Only the selected row is in the tab order; Up/Down move between rows and
 * Home/End jump to the ends, wrapping at both edges. That's the expected
 * behaviour for a `tablist`-shaped rail, and it's the reason this is a
 * component rather than an inline `ListRow.map` — hand-composing it at each
 * call site means re-deriving the focus management, usually wrongly.
 *
 * Selection follows focus, matching the automatic-activation tab pattern.
 * That suits panels that are cheap to switch; it would be the wrong choice
 * if selecting a row triggered an expensive load.
 */
export function NavList({ groups, value, onChange, ariaLabel, panelIdPrefix, className }: NavListProps) {
  const base = useId();
  const rowId = useCallback((itemId: string) => `${base}-${itemId}`, [base]);

  const moveTo = useCallback(
    (id: string | undefined) => {
      if (id === undefined) return;
      onChange(id);
      // Focus must follow selection, or the roving tabindex strands the user
      // on a row that is no longer tabbable.
      document.getElementById(rowId(id))?.focus();
    },
    [onChange, rowId],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const direction =
        event.key === "ArrowDown"
          ? "next"
          : event.key === "ArrowUp"
            ? "previous"
            : event.key === "Home"
              ? "first"
              : event.key === "End"
                ? "last"
                : undefined;
      if (direction === undefined) return;
      event.preventDefault();
      moveTo(nextNavItemId(groups, value, direction));
    },
    [groups, value, moveTo],
  );

  const isTabList = panelIdPrefix !== undefined;

  return (
    <div
      className={[styles.list, className].filter(Boolean).join(" ")}
      role={isTabList ? "tablist" : "listbox"}
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {groups.map((group) => (
        <div key={group.id} className={styles.group}>
          {group.label !== undefined && (
            <SectionLabel className={styles.groupLabel} label={group.label} icon={group.icon} />
          )}
          {group.items.map((item) => {
            const selected = item.id === value;
            return (
              <ListRow
                key={item.id}
                id={rowId(item.id)}
                role={isTabList ? "tab" : "option"}
                /* ListRow defaults to aria-pressed (toggle-button semantics).
                   Both tab and option express state via aria-selected, and
                   aria-pressed is invalid on them, so clear it. */
                aria-pressed={undefined}
                aria-selected={selected}
                aria-controls={isTabList ? `${panelIdPrefix}-${item.id}` : undefined}
                tabIndex={selected ? 0 : -1}
                selected={selected}
                disabled={item.disabled ?? false}
                leading={item.icon}
                trailing={item.trailing}
                onClick={() => onChange(item.id)}
              >
                {item.label}
              </ListRow>
            );
          })}
        </div>
      ))}
    </div>
  );
}
