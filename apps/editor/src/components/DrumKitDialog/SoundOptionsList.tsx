import { Check } from "lucide-react";
import type { SoundCategory, SoundCategoryGroup, SoundEntry } from "./soundCatalog";
import styles from "./SoundCombobox.module.css";

export interface SoundOptionsListProps {
  readonly groups: readonly SoundCategoryGroup[];
  /** Active category filter; when narrowed to one, group labels are redundant. */
  readonly category: SoundCategory | "all";
  readonly selectedEntry: SoundEntry | undefined;
  readonly activeEntry: SoundEntry | undefined;
  /** Current search text, shown in the empty state. */
  readonly query: string;
  readonly optionId: (entry: SoundEntry) => string;
  /** Make an entry the keyboard-active one (mouse hover). */
  readonly onActivate: (entry: SoundEntry) => void;
  /** Pick + audition an entry. */
  readonly onCommit: (entry: SoundEntry) => void;
}

/** The grouped option rows inside the combobox listbox (category headers +
 *  per-sound rows). Split out of `SoundCombobox` to keep that component small. */
export function SoundOptionsList({
  groups,
  category,
  selectedEntry,
  activeEntry,
  query,
  optionId,
  onActivate,
  onCommit,
}: SoundOptionsListProps) {
  if (groups.length === 0) {
    return <p className={styles.noResults}>No sounds match “{query}”.</p>;
  }
  return (
    <>
      {groups.map((group) => (
        <div key={group.category} className={styles.group}>
          {/* The pill filter already names the category when narrowed to one. */}
          {category === "all" ? <div className={styles.groupLabel}>{group.label}</div> : null}
          {group.entries.map((entry) => {
            const isSelected = entry === selectedEntry;
            const isActive = entry === activeEntry;
            return (
              // eslint-disable-next-line no-restricted-syntax -- bespoke listbox option row: name + kit badge + key, picks & auditions on click
              <button
                key={`${entry.kitProgram}:${entry.key}`}
                type="button"
                role="option"
                id={optionId(entry)}
                aria-selected={isSelected}
                className={`${styles.option} ${isActive ? styles.optionActive : ""} ${
                  isSelected ? styles.optionSelected : ""
                }`}
                onMouseEnter={() => onActivate(entry)}
                onClick={() => onCommit(entry)}
              >
                <span className={styles.optionCheck}>{isSelected ? <Check size={14} /> : null}</span>
                <span className={styles.optionName}>{entry.label}</span>
                {!entry.isDefaultKit ? <span className={styles.optionKit}>{entry.kitName}</span> : null}
                <span className={styles.optionKey}>{entry.key}</span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
