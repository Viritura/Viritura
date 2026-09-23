import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Globe2, LockKeyhole, Search } from "lucide-react";
import type { CreatedGitHubRepository } from "../../github/api";
import styles from "./GitHubRepositoryCombobox.module.css";

interface GitHubRepositoryComboboxProps {
  readonly value: string;
  readonly repositories: readonly CreatedGitHubRepository[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}

interface PopupRect {
  top: number;
  left: number;
  width: number;
}

export function GitHubRepositoryCombobox(props: GitHubRepositoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<PopupRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const filtered = useMemo(() => {
    const query = props.value.trim().toLocaleLowerCase();
    if (
      !query ||
      (query.includes("/") && props.repositories.some((repo) => repo.fullName.toLocaleLowerCase() === query))
    ) {
      return props.repositories;
    }
    return props.repositories.filter((repository) => repository.fullName.toLocaleLowerCase().includes(query));
  }, [props.repositories, props.value]);
  const activeRepository = filtered[activeIndex];

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
    (repository: CreatedGitHubRepository) => {
      props.onChange(repository.fullName);
      close();
    },
    [close, props],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) show();
      else setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && open && activeRepository) {
      event.preventDefault();
      select(activeRepository);
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
        {/* eslint-disable-next-line no-restricted-syntax -- bespoke ARIA combobox input inside a composite search control */}
        <input
          className={styles.input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeRepository ? `${listboxId}-${activeRepository.id}` : undefined}
          value={props.value}
          placeholder="Search repositories or paste a GitHub URL"
          onFocus={show}
          onChange={(event) => {
            props.onChange(event.target.value);
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
            <div id={listboxId} className={styles.list} role="listbox" aria-label="Accessible GitHub repositories">
              {props.loading ? (
                <p className={styles.message}>Loading repositories</p>
              ) : props.error ? (
                <p className={styles.error} role="alert">
                  {props.error}
                </p>
              ) : filtered.length === 0 ? (
                <p className={styles.message}>No accessible repositories match this search.</p>
              ) : (
                filtered.map((repository, index) => {
                  const selected = repository.fullName.toLocaleLowerCase() === props.value.trim().toLocaleLowerCase();
                  return (
                    // eslint-disable-next-line no-restricted-syntax -- bespoke ARIA listbox option controlled by the combobox
                    <button
                      id={`${listboxId}-${repository.id}`}
                      key={repository.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={index === activeIndex ? styles.optionActive : styles.option}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(repository)}
                    >
                      <span className={styles.optionCheck}>{selected && <Check size={14} aria-hidden="true" />}</span>
                      {repository.private ? (
                        <LockKeyhole size={14} aria-hidden="true" />
                      ) : (
                        <Globe2 size={14} aria-hidden="true" />
                      )}
                      <span className={styles.optionName}>{repository.fullName}</span>
                      <span className={styles.visibility}>{repository.private ? "Private" : "Public"}</span>
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
