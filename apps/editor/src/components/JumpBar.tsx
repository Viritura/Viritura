/**
 * JumpBar — VS Code-style command palette for quick action discovery and execution.
 *
 * - Fuzzy keyword matching on label, shortcut, and category
 * - Keyboard navigation (ArrowUp/Down, Enter, Escape)
 * - Shows shortcut hints on the right side of each entry
 * - Grouped by category with a muted heading
 */

import { useEffect, useRef, useState, useCallback, useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { FormInput } from "@viritura/ui";
import { resolveJumpBarResults } from "../jumpBar";

const JUMPBAR_BACKDROP_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.25)",
  zIndex: 10001,
};
const JUMPBAR_HEADER_STYLE: CSSProperties = {
  padding: "10px 12px 6px",
  borderBottom: "1px solid var(--border, #e0e0e0)",
};
const JUMPBAR_INPUT_STYLE: CSSProperties = {
  width: "100%",
  fontSize: "var(--type-small-size)",
  padding: "6px 8px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  outline: "none",
  background: "var(--surface-sunken)",
  boxShadow: "var(--inset-soft)",
  color: "var(--text)",
  boxSizing: "border-box",
};
const JUMPBAR_LIST_STYLE: CSSProperties = { overflowY: "auto", padding: "4px 0", flex: 1 };
const JUMPBAR_EMPTY_STYLE: CSSProperties = {
  padding: "16px",
  textAlign: "center",
  color: "var(--text-muted, #999)",
  fontSize: "var(--type-small-size)",
};
const JUMPBAR_FOOTER_STYLE: CSSProperties = {
  padding: "4px 14px 6px",
  borderTop: "1px solid var(--border, #e0e0e0)",
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted, #aaa)",
  display: "flex",
  gap: 12,
};
const JUMPBAR_ROW_INNER_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 8, minWidth: 0 };
const JUMPBAR_LABEL_STYLE: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function jumpBarPaletteStyle(width: number): CSSProperties {
  return {
    position: "fixed",
    top: 80,
    left: "50%",
    transform: "translateX(-50%)",
    width,
    maxHeight: "min(480px, calc(100vh - 160px))",
    background: "var(--bg, #fff)",
    borderRadius: 10,
    boxShadow: "0 8px 32px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.12)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    zIndex: 10002,
    border: "1px solid var(--border, #ccc)",
  };
}
function jumpBarRowStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 14px",
    cursor: "pointer",
    background: active ? "var(--accent, #215e4e)" : "transparent",
    color: active ? "#fff" : "var(--text, #333)",
    fontSize: "var(--type-small-size)",
    transition: "background 0.05s",
  };
}
function jumpBarCategoryStyle(active: boolean): CSSProperties {
  return {
    fontSize: "var(--type-eyebrow-size)",
    fontWeight: "var(--type-heading-weight)",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    opacity: active ? 0.8 : 0.5,
    whiteSpace: "nowrap",
    flexShrink: 0,
    minWidth: 60,
  };
}
function jumpBarShortcutStyle(active: boolean): CSSProperties {
  return {
    fontSize: "var(--type-eyebrow-size)",
    fontFamily: "monospace",
    opacity: active ? 0.8 : 0.45,
    whiteSpace: "nowrap",
    marginLeft: 12,
    flexShrink: 0,
  };
}

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface JumpBarAction {
  /** Unique identifier */
  id: string;
  /** Display label (e.g. "Toggle Note Input") */
  label: string;
  /** Category for grouping (e.g. "File", "Edit", "Navigation") */
  category: string;
  /** Keyboard shortcut hint (e.g. "Ctrl+S") — display only */
  shortcut?: string;
  /** Extra search keywords that aren't in the label */
  keywords?: string[];
  /** Execute the action */
  execute: () => void;
  /** Whether the action is currently available (default: true) */
  enabled?: () => boolean;
  /** Keep large dynamic catalogs out of the unfiltered default list. */
  hideWhenEmpty?: boolean;
}

export interface JumpBarProps {
  open: boolean;
  onClose: () => void;
  actions: JumpBarAction[];
  resolveQueryAction?: (query: string) => JumpBarAction | null;
}

// ═══════════════════════════════════════════
// Platform detection
// ═══════════════════════════════════════════

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

function formatShortcut(shortcut: string): string {
  if (!IS_MAC) return shortcut;
  return shortcut
    .replace(/Ctrl\+/g, "⌘")
    .replace(/Alt\+/g, "⌥")
    .replace(/Shift\+/g, "⇧");
}

// ═══════════════════════════════════════════
// Component
// ═══════════════════════════════════════════

export function JumpBar({ open, onClose, actions, resolveQueryAction }: JumpBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Filter and sort actions
  const filtered = useMemo(
    () => resolveJumpBarResults(actions, query, resolveQueryAction),
    [actions, query, resolveQueryAction],
  );

  // Clamp selection on filter changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const executeSelected = useCallback(() => {
    const action = filtered[selectedIndex];
    if (action) {
      onClose();
      // Defer execution so the palette closes first
      requestAnimationFrame(() => action.execute());
    }
  }, [filtered, selectedIndex, onClose]);

  // Keyboard handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          return;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          executeSelected();
          return;
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, filtered.length, executeSelected, onClose]);

  if (!open) return null;

  return createPortal(
    <JumpBarPalette
      query={query}
      onQueryChange={(q) => {
        setQuery(q);
        setSelectedIndex(0);
      }}
      inputRef={inputRef}
      listRef={listRef}
      filtered={filtered}
      selectedIndex={selectedIndex}
      setSelectedIndex={setSelectedIndex}
      executeSelected={executeSelected}
      onClose={onClose}
    />,
    document.body,
  );
}

interface JumpBarPaletteProps {
  readonly query: string;
  readonly onQueryChange: (q: string) => void;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly listRef: React.RefObject<HTMLDivElement | null>;
  readonly filtered: readonly JumpBarAction[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: (i: number) => void;
  readonly executeSelected: () => void;
  readonly onClose: () => void;
}

function JumpBarPalette({
  query,
  onQueryChange,
  inputRef,
  listRef,
  filtered,
  selectedIndex,
  setSelectedIndex,
  executeSelected,
  onClose,
}: JumpBarPaletteProps) {
  return (
    <>
      {/* Backdrop */}
      <div style={JUMPBAR_BACKDROP_STYLE} onClick={onClose} />
      {/* Palette */}
      <div style={jumpBarPaletteStyle(Math.min(560, typeof window !== "undefined" ? window.innerWidth - 32 : 560))}>
        {/* Search input */}
        <div style={JUMPBAR_HEADER_STYLE}>
          <FormInput
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Type a command or location…"
            autoComplete="off"
            spellCheck={false}
            style={JUMPBAR_INPUT_STYLE}
          />
        </div>
        {/* Results list */}
        <div ref={listRef} style={JUMPBAR_LIST_STYLE}>
          {filtered.length === 0 && <div style={JUMPBAR_EMPTY_STYLE}>No matching commands</div>}
          {filtered.map((action, i) => (
            <JumpBarRow
              key={action.id}
              action={action}
              active={i === selectedIndex}
              onHover={() => setSelectedIndex(i)}
              onClick={() => {
                setSelectedIndex(i);
                requestAnimationFrame(executeSelected);
              }}
            />
          ))}
        </div>
        {/* Footer hint */}
        <div style={JUMPBAR_FOOTER_STYLE}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span>m125 measure · rA rehearsal</span>
        </div>
      </div>
    </>
  );
}

interface JumpBarRowProps {
  readonly action: JumpBarAction;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onClick: () => void;
}

function JumpBarRow({ action, active, onHover, onClick }: JumpBarRowProps) {
  return (
    <div onClick={onClick} onMouseEnter={onHover} style={jumpBarRowStyle(active)}>
      <div style={JUMPBAR_ROW_INNER_STYLE}>
        <span style={jumpBarCategoryStyle(active)}>{action.category}</span>
        <span style={JUMPBAR_LABEL_STYLE}>{action.label}</span>
      </div>
      {action.shortcut && <span style={jumpBarShortcutStyle(active)}>{formatShortcut(action.shortcut)}</span>}
    </div>
  );
}
