import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { MenuItem } from "./MenuItem";
import type { MenuItemDef } from "./index";
import styles from "./Menu.module.css";

function menuPositionStyle(top: number, left: number): CSSProperties {
  return { position: "fixed", top, left, zIndex: 10000 };
}

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly items: readonly MenuItemDef[];
}

export interface ContextMenuProps {
  readonly state: ContextMenuState | null;
  readonly onClose: () => void;
}

export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Position at mouse coords, then clamp to viewport after mount
  useEffect(() => {
    if (!state) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Start at the click position
    let left = state.x;
    let top = state.y;
    // After the menu renders, clamp to viewport
    requestAnimationFrame(() => {
      const el = menuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (left + rect.width > window.innerWidth) {
        left = window.innerWidth - rect.width - 4;
      }
      if (top + rect.height > window.innerHeight) {
        top = window.innerHeight - rect.height - 4;
      }
      setPos({ top: Math.max(4, top), left: Math.max(4, left) });
      el.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    });
    setPos({ top, left });
  }, [state]);

  const closeAndRestoreFocus = useCallback(() => {
    const previousFocus = previousFocusRef.current;
    onClose();
    requestAnimationFrame(() => previousFocus?.focus());
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    if (!state) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [state, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!state) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAndRestoreFocus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [state, closeAndRestoreFocus]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1) % items.length
            : (currentIndex <= 0 ? items.length : currentIndex) - 1;
    items[nextIndex]?.focus();
  };

  if (!state) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className={styles.dropdown}
      style={menuPositionStyle(pos.top, pos.left)}
      // The menu is portaled to <body>, i.e. outside a modal Radix Dialog's
      // content. Without this, Radix treats a click on a menu item as an
      // "interact outside" and dismisses the whole dialog. Stopping the
      // pointer-down here keeps the interaction scoped to the menu.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {state.items.map((item, i) => (
        <MenuItem key={i} item={item} onClose={closeAndRestoreFocus} />
      ))}
    </div>,
    document.body,
  );
}
