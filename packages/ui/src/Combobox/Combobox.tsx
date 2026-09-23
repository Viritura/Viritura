import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import styles from "./Combobox.module.css";

export interface ComboboxOption {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly trailingLabel?: string;
}

export interface ComboboxProps {
  readonly value: string;
  readonly options: readonly ComboboxOption[];
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
  readonly ariaLabel: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly loadingMessage?: string;
  readonly emptyMessage?: string;
}

interface PopupRect {
  top: number;
  left: number;
  width: number;
}

export function Combobox({
  value,
  options,
  onValueChange,
  placeholder,
  ariaLabel,
  loading = false,
  error = null,
  loadingMessage = "Loading options",
  emptyMessage = "No options match this search.",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<PopupRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const filtered = useMemo(() => {
    const query = value.trim().toLocaleLowerCase();
    const exactMatch = options.some((option) => option.label.toLocaleLowerCase() === query);
    if (!query || exactMatch) return options;
    return options.filter((option) => option.label.toLocaleLowerCase().includes(query));
  }, [options, value]);
  const activeOption = filtered[activeIndex];

  const measure = useCallback(() => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (bounds) setRect({ top: bounds.bottom + 4, left: bounds.left, width: bounds.width });
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const show = useCallback(() => {
    measure();
    setActiveIndex(0);
    setOpen(true);
  }, [measure]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) close();
    };
    const handleLayout = () => measure();
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleLayout);
    window.addEventListener("scroll", handleLayout, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleLayout);
      window.removeEventListener("scroll", handleLayout, true);
    };
  }, [close, measure, open]);

  const select = useCallback(
    (option: ComboboxOption) => {
      onValueChange(option.label);
      close();
    },
    [close, onValueChange],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) show();
      else setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && open && activeOption) {
      event.preventDefault();
      select(activeOption);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  };

  const popupStyle: CSSProperties | undefined = rect
    ? { top: rect.top, left: rect.left, width: rect.width }
    : undefined;

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={open ? styles.controlOpen : styles.control}>
        <Search size={15} aria-hidden="true" />
        <input
          className={styles.input}
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOption ? `${listboxId}-${activeOption.id}` : undefined}
          value={value}
          placeholder={placeholder}
          onFocus={show}
          onChange={(event) => {
            onValueChange(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        <ChevronDown size={16} aria-hidden="true" />
      </div>
      {open &&
        rect &&
        createPortal(
          <div ref={popupRef} className={styles.popup} style={popupStyle}>
            <div id={listboxId} className={styles.list} role="listbox" aria-label={ariaLabel}>
              {loading ? (
                <p className={styles.message}>{loadingMessage}</p>
              ) : error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : filtered.length === 0 ? (
                <p className={styles.message}>{emptyMessage}</p>
              ) : (
                filtered.map((option, index) => {
                  const selected = option.label.toLocaleLowerCase() === value.trim().toLocaleLowerCase();
                  return (
                    <button
                      id={`${listboxId}-${option.id}`}
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={index === activeIndex ? styles.optionActive : styles.option}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(option)}
                    >
                      <span className={styles.optionCheck}>{selected && <Check size={14} aria-hidden="true" />}</span>
                      <span className={styles.optionIcon}>{option.icon}</span>
                      <span className={styles.optionName}>{option.label}</span>
                      {option.trailingLabel && <span className={styles.trailingLabel}>{option.trailingLabel}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
