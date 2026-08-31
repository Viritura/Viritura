import {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
  useId,
  type KeyboardEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import {
  groupedSounds,
  findSoundEntry,
  drumKitForEntry,
  CATEGORY_LABELS,
  type SoundCategory,
  type SoundEntry,
} from "./soundCatalog";
import { SoundOptionsList } from "./SoundOptionsList";
import styles from "./SoundCombobox.module.css";

export interface SoundComboboxProps {
  /** Currently bound sound. */
  readonly drumKit: number | undefined;
  readonly midiKey: number;
  /** Pick a sound: reports the new key + the implied drumKit override. */
  readonly onPick: (midiKey: number, drumKit: number | undefined) => void;
  /** Audition a sound without committing. */
  readonly onPreview: (midiKey: number, drumKit: number | undefined) => void;
}

const CATEGORY_FILTERS: ReadonlyArray<{ id: SoundCategory | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "kick", label: CATEGORY_LABELS.kick },
  { id: "snare", label: CATEGORY_LABELS.snare },
  { id: "hihat", label: CATEGORY_LABELS.hihat },
  { id: "tom", label: CATEGORY_LABELS.tom },
  { id: "cymbal", label: CATEGORY_LABELS.cymbal },
  { id: "percussion", label: CATEGORY_LABELS.percussion },
  { id: "world", label: CATEGORY_LABELS.world },
];

/** Fixed-position rect for the portaled popup, anchored under the control. */
interface PopupRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly maxHeight: number;
}

/**
 * Combobox for picking a percussion sound: one input that shows the bound sound
 * when closed and filters as you type when open, over a grouped (category)
 * listbox with quick category-filter pills. Picking a sound from a non-default
 * kit transparently sets the `drumKit` borrow override, so the user never types
 * a MIDI key or knows which kit a sound lives in.
 *
 * The popup is portaled to <body> and fixed-positioned under the control so it
 * overlays sibling fields instead of being clipped by the inspector column's
 * own scroll container.
 */
export function SoundCombobox({ drumKit, midiKey, onPick, onPreview }: SoundComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SoundCategory | "all">("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<PopupRect | null>(null);

  const controlRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selected = findSoundEntry(drumKit, midiKey);
  const selectedLabel = selected?.label ?? `Key ${midiKey}`;
  const selectedKit = selected && !selected.isDefaultKit ? selected.kitName : null;

  const groups = useMemo(() => {
    const all = groupedSounds(query);
    return category === "all" ? all : all.filter((g) => g.category === category);
  }, [query, category]);

  // Flat, render-ordered list backing keyboard navigation across groups.
  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);

  const optionId = useCallback((e: SoundEntry) => `${listboxId}-${e.kitProgram}-${e.key}`, [listboxId]);

  const measure = useCallback(() => {
    const el = controlRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    // Bound the popup height: a ceiling so the ~200-sound list always scrolls
    // within the popup (never grows past the dialog), and a floor so it stays
    // usable even when the control sits low in a short viewport.
    const available = window.innerHeight - r.bottom - gap - 8;
    const maxHeight = Math.max(200, Math.min(440, available));
    setRect({ top: r.bottom + gap, left: r.left, width: r.width, maxHeight });
  }, []);

  const openMenu = useCallback(() => {
    if (open) return;
    setQuery("");
    setActiveIndex(0);
    measure();
    setOpen(true);
  }, [open, measure]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const commit = useCallback(
    (entry: SoundEntry) => {
      const kit = drumKitForEntry(entry);
      onPick(entry.key, kit);
      onPreview(entry.key, kit);
      closeMenu();
    },
    [onPick, onPreview, closeMenu],
  );

  // Reposition while open (scroll/resize); the control can move as the dialog
  // body scrolls underneath the portaled popup.
  useEffect(() => {
    if (!open) return;
    measure();
    const onScroll = () => measure();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, measure]);

  // Close on outside pointer-down (control + portaled popup are both "inside").
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (controlRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      closeMenu();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, closeMenu]);

  // Keep the keyboard-active option in view.
  useEffect(() => {
    if (!open) return;
    const active = flat[activeIndex];
    if (!active) return;
    popupRef.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, flat, optionId]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!open) return openMenu();
        setActiveIndex((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!open) return openMenu();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        if (open && flat[activeIndex]) {
          e.preventDefault();
          commit(flat[activeIndex]);
        }
      } else if (e.key === "Escape") {
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          closeMenu();
        }
      }
    },
    [open, openMenu, flat, activeIndex, commit, closeMenu],
  );

  const activeEntry = flat[activeIndex];

  // Position the popup; the height cap goes on the scrolling list itself (not
  // the popup) — a flex child can't resolve a scroll height when its parent
  // only has `max-height` (an indefinite height), so it would collapse to 0.
  const popupStyle: CSSProperties | undefined = rect
    ? { top: rect.top, left: rect.left, width: rect.width }
    : undefined;
  const listStyle: CSSProperties | undefined = rect ? { maxHeight: rect.maxHeight } : undefined;

  return (
    <div className={styles.root} ref={controlRef}>
      <div className={open ? styles.controlOpen : styles.control}>
        <Search size={15} className={styles.searchIcon} aria-hidden />
        {/* eslint-disable-next-line no-restricted-syntax -- bespoke combobox input: ARIA combobox role + aria-activedescendant, rendered bare inside the styled control wrapper (FormInput would re-apply its own border/padding) */}
        <input
          ref={inputRef}
          className={styles.input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeEntry ? optionId(activeEntry) : undefined}
          placeholder="Search sounds… (e.g. gong, snare, crash)"
          value={open ? query : selectedLabel}
          onFocus={openMenu}
          onMouseDown={openMenu}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        {!open && selectedKit ? <span className={styles.kitBadge}>{selectedKit}</span> : null}
        <ChevronDown size={16} className={styles.chevron} aria-hidden />
      </div>

      {open && rect
        ? createPortal(
            <div ref={popupRef} className={styles.popup} style={popupStyle}>
              <div
                className={styles.filters}
                role="group"
                aria-label="Sound categories"
                // Keep the input focused (don't blur) when clicking a pill, so
                // typing keeps working. Scoped to the filters row so the list's
                // scrollbar stays draggable (a root-level preventDefault blocks it).
                onMouseDown={(e) => e.preventDefault()}
              >
                {CATEGORY_FILTERS.map((f) => (
                  // eslint-disable-next-line no-restricted-syntax -- bespoke category filter chip (pill toggle), not a text button
                  <button
                    key={f.id}
                    type="button"
                    className={f.id === category ? styles.filterActive : styles.filter}
                    aria-pressed={f.id === category}
                    onClick={() => {
                      setCategory(f.id);
                      setActiveIndex(0);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div
                className={styles.list}
                style={listStyle}
                role="listbox"
                id={listboxId}
                aria-label="Sounds"
                // The popup is portaled to <body>, outside the modal Dialog's
                // content. Radix's scroll-lock (react-remove-scroll) listens on
                // document in the bubble phase and preventDefaults wheel/touch
                // events outside the dialog — which would block scrolling here.
                // Stop propagation so the event never reaches that listener; the
                // browser then scrolls this list natively.
                onWheel={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
              >
                <SoundOptionsList
                  groups={groups}
                  category={category}
                  selectedEntry={selected}
                  activeEntry={activeEntry}
                  query={query}
                  optionId={optionId}
                  onActivate={(entry) => setActiveIndex(flat.indexOf(entry))}
                  onCommit={commit}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
