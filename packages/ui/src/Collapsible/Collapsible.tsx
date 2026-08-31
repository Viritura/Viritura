import { useState, type ReactNode } from "react";
import * as RadixCollapsible from "@radix-ui/react-collapsible";
import styles from "./Collapsible.module.css";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export interface CollapsibleProps {
  /** Section title */
  title: string;
  /** Optional keyboard shortcut hint shown after the title */
  shortcut?: string;
  /** Optional icon before the title */
  icon?: ReactNode;
  /** Optional extra controls rendered on the right side of the header */
  actions?: ReactNode;
  /** Whether the section starts open */
  defaultOpen?: boolean;
  /** Controlled open state */
  open?: boolean;
  /** Called when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Section content */
  children: ReactNode;
  /** Additional className */
  className?: string;
}

export function Collapsible({
  title,
  shortcut,
  icon,
  actions,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
}: CollapsibleProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;

  const handleChange = (value: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(value);
    onOpenChange?.(value);
  };

  return (
    <RadixCollapsible.Root open={open} onOpenChange={handleChange} className={`${styles.container} ${className ?? ""}`}>
      <div className={styles.header}>
        <RadixCollapsible.Trigger asChild>
          <button type="button" className={styles.trigger} aria-expanded={open}>
            <ChevronIcon open={open} />
            {icon && <span className={styles.icon}>{icon}</span>}
            <span className={styles.title}>{title}</span>
            {shortcut && <span className={styles.shortcut}>{shortcut}</span>}
          </button>
        </RadixCollapsible.Trigger>
        {actions && <span className={styles.actions}>{actions}</span>}
      </div>
      <RadixCollapsible.Content className={styles.content}>
        <div className={styles.contentInner}>{children}</div>
      </RadixCollapsible.Content>
    </RadixCollapsible.Root>
  );
}
