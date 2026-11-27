import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../Button/Button";
import styles from "./TextPopover.module.css";

function popoverPositionStyle(x: number, y: number): CSSProperties {
  return { left: x, top: y };
}

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface TextPopoverProps {
  /** Whether the popover is open */
  open: boolean;
  /** Called when the popover should close (Escape, click outside) */
  onClose: () => void;
  /** Called when text is submitted (Enter); return exactly `false` to keep the draft open. */
  onSubmit: (value: string) => unknown;
  /** Position to render at (screen coordinates, popover centers horizontally) */
  position: { x: number; y: number };
  /** Title shown above the input */
  title?: string;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Initial value to populate the input */
  initialValue?: string;
  /** Controlled input value for popovers with additional editing controls. */
  value?: string;
  /** Called whenever the input value changes. */
  onValueChange?: (value: string) => void;
  /** Optional input-specific keyboard editing. */
  onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  /** Validate input — return null if valid, or an error string.
   *  When invalid, Enter does not submit. */
  validate?: (value: string) => string | null;
  /** Optional live preview rendered below the input */
  renderPreview?: (value: string) => ReactNode | null;
  /** Whether to allow submitting empty values. Default: false */
  allowEmpty?: boolean;
  /** Input type. Default: "text" */
  inputType?: "text" | "number";
  /** Extra content rendered below the input */
  children?: ReactNode;
  /** Optional styling for popovers with additional controls. */
  className?: string;
  /** Optional button for submitting without a keyboard. */
  submitLabel?: string;
  /** Optional continuous-entry navigation handler. Returning true clears the
   * current value and keeps the popover open at the caller's next target. */
  onNavigate?: (value: string, command: TextPopoverNavigationCommand) => boolean;
  /** Space navigation target; defaults to the caller's next/previous target. */
  spaceNavigation?: "target" | "measure";
}

export type TextPopoverNavigationCommand =
  "next" | "previous" | "nextBeat" | "previousBeat" | "nextMeasure" | "previousMeasure";

// ═══════════════════════════════════════════
// Component
// ═══════════════════════════════════════════

export function TextPopover({
  open,
  onClose,
  onSubmit,
  position,
  title,
  placeholder,
  initialValue = "",
  value: controlledValue,
  onValueChange,
  onInputKeyDown,
  validate,
  renderPreview,
  allowEmpty = false,
  inputType = "text",
  children,
  className,
  submitLabel,
  onNavigate,
  spaceNavigation = "target",
}: TextPopoverProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverSize, setPopoverSize] = useState({ width: 180, height: 120 });
  const [internalValue, setInternalValue] = useState(initialValue);
  const isControlled = controlledValue !== undefined;
  const value = controlledValue ?? internalValue;
  const setValue = useCallback(
    (next: string) => {
      if (!isControlled) setInternalValue(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  // Reset on open
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      if (!isControlled) setInternalValue(initialValue);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open, initialValue, isControlled]);

  useLayoutEffect(() => {
    const element = popoverRef.current;
    if (!open || !element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setPopoverSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  const validationError = validate?.(value) ?? null;
  const canSubmit = (allowEmpty || value.trim().length > 0) && validationError === null;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    if (onSubmit(value) !== false) onClose();
  }, [canSubmit, value, onSubmit, onClose]);

  const handleNavigate = useCallback(
    (command: TextPopoverNavigationCommand) => {
      if (!onNavigate || (value.trim().length > 0 && validationError !== null)) return;
      if (onNavigate(value, command)) setValue("");
    },
    [onNavigate, setValue, validationError, value],
  );

  // Keyboard: Enter to submit, Escape to cancel
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (document.activeElement !== inputRef.current && e.target !== inputRef.current) return;
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        handleSubmit();
        return;
      }
      const command = onNavigate
        ? e.key === " " && e.shiftKey
          ? spaceNavigation === "measure"
            ? "previousMeasure"
            : "previous"
          : e.key === " "
            ? spaceNavigation === "measure"
              ? "nextMeasure"
              : "next"
            : e.key === ":" || (e.key === ";" && e.shiftKey)
              ? "previousBeat"
              : e.key === ";"
                ? "nextBeat"
                : (e.ctrlKey || e.metaKey) && e.key === "ArrowRight"
                  ? "nextMeasure"
                  : (e.ctrlKey || e.metaKey) && e.key === "ArrowLeft"
                    ? "previousMeasure"
                    : null
        : null;
      if (command) {
        e.preventDefault();
        e.stopPropagation();
        handleNavigate(command);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose, onNavigate, spaceNavigation, handleSubmit, handleNavigate]);

  if (!open) return null;

  // Clamp to viewport
  const margin = 16;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1000;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const width = Math.min(popoverSize.width, Math.max(0, vw - margin * 2));
  const height = Math.min(popoverSize.height, Math.max(0, vh - margin * 2));
  const x = Math.max(margin + width / 2, Math.min(vw - margin - width / 2, position.x));
  const y = Math.max(margin, Math.min(vh - margin - height, position.y));

  const preview = renderPreview?.(value) ?? null;

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        ref={popoverRef}
        className={[styles.popover, className].filter(Boolean).join(" ")}
        style={popoverPositionStyle(x, y)}
      >
        {title && <div className={styles.title}>{title}</div>}
        <input
          ref={inputRef}
          className={styles.input}
          type={inputType}
          aria-label={title ?? placeholder ?? "Text"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onInputKeyDown}
          autoComplete="off"
          spellCheck={inputType === "text"}
        />
        {preview && <div className={styles.preview}>{preview}</div>}
        {children}
        {submitLabel && (
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            {submitLabel}
          </Button>
        )}
      </div>
    </>,
    document.body,
  );
}
