import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "../Button/Button";
import type { CascadingMenuItem, CascadingMenuProps } from "./types";
import styles from "./CascadingMenu.module.css";

function RenderItem({ item, container }: { readonly item: CascadingMenuItem; readonly container: HTMLElement | null }) {
  if (item.separator) {
    return <DropdownMenu.Separator className={styles.separator} />;
  }

  if (item.children && item.children.length > 0) {
    return (
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger className={styles.item} disabled={item.disabled}>
          <span>{item.label}</span>
          <ChevronRight className={styles.submenuArrow} size={14} aria-hidden="true" />
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal container={container ?? undefined}>
          <DropdownMenu.SubContent
            className={styles.subContent}
            sideOffset={4}
            alignOffset={-4}
            collisionPadding={8}
            collisionBoundary={container ?? undefined}
          >
            {item.children.map((child) => (
              <RenderItem key={child.id} item={child} container={container} />
            ))}
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
    );
  }

  return (
    <DropdownMenu.Item className={styles.item} disabled={item.disabled} onSelect={item.onSelect}>
      {item.label}
    </DropdownMenu.Item>
  );
}

/** Accessible dropdown menu with keyboard-operable nested submenus. */
export function CascadingMenu({
  ariaLabel,
  label,
  items,
  className,
  triggerFullWidth = true,
  triggerSize,
}: CascadingMenuProps) {
  // When rendered inside a modal Radix Dialog, `react-remove-scroll` blocks
  // wheel events over content portaled to `document.body`. Portaling the menu
  // into the enclosing dialog (and treating it as the collision boundary) keeps
  // the menu inside the scroll-lock's allow-tree so the wheel works, and keeps
  // it visually contained. Outside a dialog, `container` stays null and Radix
  // falls back to `document.body` as before.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const setTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    if (node) {
      setContainer(node.closest<HTMLElement>('[role="dialog"]'));
    }
  }, []);

  const triggerClass = [styles.trigger, triggerFullWidth ? styles.triggerFull : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button
          ref={setTriggerRef}
          ariaLabel={ariaLabel}
          className={triggerClass}
          fullWidth={triggerFullWidth}
          size={triggerSize}
        >
          <span className={styles.triggerLabel}>{label}</span>
          <ChevronDown className={styles.triggerIcon} size={14} aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container ?? undefined}>
        <DropdownMenu.Content
          className={styles.content}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          collisionBoundary={container ?? undefined}
        >
          {items.map((item) => (
            <RenderItem key={item.id} item={item} container={container} />
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
