import { useEffect, useRef, useState, useCallback, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  /** Called when text is submitted (Enter) */
  onSubmit: (value: string) => void;
  /** Position to render at (screen coordinates, popover centers horizontally) */
  position: { x: number; y: number };
  /** Title shown above the input */
  title?: string;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Initial value to populate the input */
  initialValue?: string;
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
}

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
  validate,
  renderPreview,
  allowEmpty = false,
  inputType = "text",
  children,
}: TextPopoverProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  // Reset on open
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setValue(initialValue);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, initialValue]);

  const validationError = validate?.(value) ?? null;
  const canSubmit = (allowEmpty || value.trim().length > 0) && validationError === null;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit(value);
    onClose();
  }, [canSubmit, value, onSubmit, onClose]);

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
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        handleSubmit();
        return;
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose, handleSubmit]);

  if (!open) return null;

  // Clamp to viewport
  const margin = 16;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1000;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const x = Math.max(margin + 90, Math.min(vw - margin - 90, position.x));
  const y = Math.max(margin, Math.min(vh - margin - 120, position.y));

  const preview = renderPreview?.(value) ?? null;

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.popover} style={popoverPositionStyle(x, y)}>
        {title && <div className={styles.title}>{title}</div>}
        <input
          ref={inputRef}
          className={styles.input}
          type={inputType}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={inputType === "text"}
        />
        {preview && <div className={styles.preview}>{preview}</div>}
        {children}
      </div>
    </>,
    document.body,
  );
}
