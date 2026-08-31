import type { ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import styles from "./Dialog.module.css";

export type DialogSize = "compact" | "default" | "wide" | "xwide" | "full";

export interface DialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when the dialog should close */
  onClose: () => void;
  /** Dialog content */
  children: ReactNode;
  /** Content width variant */
  size?: DialogSize;
  /**
   * Called when Escape is pressed while the dialog is the topmost layer.
   * Call `event.preventDefault()` to keep the dialog open — use this when an
   * inner control wants Escape first (e.g. a non-empty search field clearing
   * itself before the dialog closes).
   *
   * This has to live on the dialog rather than the inner control: Radix
   * listens for Escape on `document` in the *capture* phase, so a bubble-phase
   * `onKeyDown` inside the dialog always runs too late to stop dismissal.
   */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** Optional DOM node for embedding the dialog inside a bounded surface. */
  container?: HTMLElement | null;
  /** Disable focus trapping and body interaction locking for embedded surfaces. */
  modal?: boolean;
}

const sizeToClass: Record<DialogSize, string> = {
  compact: styles.contentCompact ?? "",
  default: styles.content ?? "",
  wide: styles.contentWide ?? "",
  xwide: styles.contentXWide ?? "",
  full: styles.contentFull ?? "",
};

/** Root dialog component wrapping Radix Dialog with glass-panel styling */
export function Dialog({
  open,
  onClose,
  children,
  size = "default",
  onEscapeKeyDown,
  container,
  modal = true,
}: DialogProps) {
  return (
    <RadixDialog.Root
      open={open}
      modal={modal}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <RadixDialog.Portal container={container}>
        <RadixDialog.Overlay className={styles.overlay} data-dialog-overlay />
        <RadixDialog.Content
          className={sizeToClass[size]}
          data-dialog-content
          aria-describedby={undefined}
          onEscapeKeyDown={onEscapeKeyDown}
        >
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Dialog title — renders as Radix Dialog.Title */
export function DialogTitle({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <RadixDialog.Title className={`${styles.title} ${className ?? ""}`}>{children}</RadixDialog.Title>;
}

/** Dialog header bar with title and close button (for wide/full dialogs) */
export function DialogHeader({
  title,
  onClose,
  closeIcon,
  children,
}: {
  title: string;
  onClose?: () => void;
  closeIcon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.header}>
      <RadixDialog.Title className={styles.headerTitle}>{title}</RadixDialog.Title>
      {children}
      {onClose && (
        <RadixDialog.Close asChild>
          <button className={styles.closeButton} aria-label="Close">
            {closeIcon ?? "✕"}
          </button>
        </RadixDialog.Close>
      )}
    </div>
  );
}

/** Scrollable dialog body area */
export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.body} ${className ?? ""}`}>{children}</div>;
}

/** Dialog action bar (bottom buttons) */
export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.actions, className].filter(Boolean).join(" ")}>{children}</div>;
}

/** Cancel button — wraps Radix Dialog.Close (closes the dialog).
 *  `onClick` runs in addition to the close; useful when callers want to
 *  fire side effects (e.g. "Reject changes") on the same gesture. */
export function DialogCancelButton({
  children = "Cancel",
  onClick,
  testId,
}: {
  children?: ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <RadixDialog.Close asChild>
      <button className={styles.btnCancel} onClick={onClick} data-testid={testId}>
        {children}
      </button>
    </RadixDialog.Close>
  );
}

/** Secondary action button — same chrome as cancel but does NOT close
 * the dialog. Use for in-dialog navigation like "Back" in a wizard. */
export function DialogSecondaryButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={styles.btnSecondary} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Primary action button */
export function DialogPrimaryButton({
  children,
  onClick,
  disabled = false,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button className={styles.btnPrimary} onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  );
}
