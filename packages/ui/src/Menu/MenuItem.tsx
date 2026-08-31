import { useCallback, useRef, useState, type CSSProperties } from "react";
import type { MenuItemDef } from "./index";
import styles from "./Menu.module.css";

const MENU_ITEM_ROOT_STYLE: CSSProperties = { position: "relative" };
const MENU_ITEM_SUBMENU_STYLE: CSSProperties = { position: "absolute", left: "100%", top: 0 };

export interface MenuItemProps {
  readonly item: MenuItemDef;
  readonly onClose: () => void;
}

const SUBMENU_CLOSE_DELAY_MS = 200;

export function MenuItem({ item, onClose }: MenuItemProps) {
  const handleClick = useCallback(() => {
    if (item.disabled || !item.action) return;
    item.action();
    onClose();
  }, [item, onClose]);

  const [submenuOpen, setSubmenuOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setSubmenuOpen(false), SUBMENU_CLOSE_DELAY_MS);
  }, [cancelClose]);

  const openSubmenu = useCallback(() => {
    cancelClose();
    setSubmenuOpen(true);
  }, [cancelClose]);

  if (item.separator) {
    return <div role="separator" className={styles.separator} />;
  }

  const hasSubmenu = item.children && item.children.length > 0;

  return (
    <div
      style={MENU_ITEM_ROOT_STYLE}
      onMouseEnter={hasSubmenu ? openSubmenu : undefined}
      onMouseLeave={hasSubmenu ? scheduleClose : undefined}
    >
      <button
        role="menuitem"
        onClick={hasSubmenu ? undefined : handleClick}
        disabled={item.disabled}
        className={styles.menuItem}
        aria-disabled={item.disabled}
        aria-haspopup={hasSubmenu ? "menu" : undefined}
        aria-expanded={hasSubmenu ? submenuOpen : undefined}
        tabIndex={-1}
      >
        <span>{item.label}</span>
        {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
        {hasSubmenu && <span className={styles.submenuArrow}>&#x25B8;</span>}
      </button>
      {hasSubmenu && submenuOpen && (
        <div
          className={`viritura-submenu ${styles.submenu}`}
          style={MENU_ITEM_SUBMENU_STYLE}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {item.children!.map((child, i) => (
            <MenuItem key={i} item={child} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  );
}
