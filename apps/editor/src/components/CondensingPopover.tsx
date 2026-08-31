/**
 * CondensingPopover — floating panel for condensing mode control.
 *
 * Shows routing mode options (a 2, solo 1., solo 2., divisi) for a
 * condensed staff. Triggered by Alt+C keyboard shortcut.
 *
 * Currently display-only — Phase 7 will add active routing + note input.
 */
import { useEffect, useRef } from "react";

/** Available condensing routing modes. */
export type CondensingMode = "unison" | "solo1" | "solo2" | "amalgamate" | "divisi";

interface CondensingPopoverProps {
  /** Whether the popover is visible. */
  readonly open: boolean;
  /** Absolute position (x, y) to anchor the popover. */
  readonly position: { x: number; y: number };
  /** Currently active mode (from merge analysis). */
  readonly currentMode?: CondensingMode;
  /** Number of sources on the condensing staff. */
  readonly sourceCount: number;
  /** Staff label (e.g. "Fl. 1, 2"). */
  readonly staffLabel?: string;
  /** Called when user selects a mode. */
  readonly onSelectMode: (mode: CondensingMode) => void;
  /** Called when the popover should close. */
  readonly onClose: () => void;
  /** Called when user clicks "Staff grouping..." to open the condensing change dialog. */
  readonly onOpenStaffGrouping?: () => void;
}

const popoverStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 1000,
  background: "var(--surface, #f2efe9)",
  border: "1px solid var(--border, #d0cdc6)",
  borderRadius: 6,
  padding: "8px 0",
  minWidth: 200,
  boxShadow: "var(--elevation-1, 0 4px 12px rgba(0,0,0,0.12))",
  fontSize: "var(--type-small-size)",
  color: "var(--text, #3a3832)",
};

const headerStyle: React.CSSProperties = {
  padding: "4px 12px 8px",
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted, #5a5850)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid var(--border, #d0cdc6)",
  marginBottom: 4,
};

const itemStyle: React.CSSProperties = {
  padding: "6px 12px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const activeItemStyle: React.CSSProperties = {
  background: "color-mix(in srgb, var(--accent, #215e4e) 15%, transparent)",
};

const radioStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: "50%",
  border: "2px solid var(--text-muted, #5a5850)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const radioActiveStyle: React.CSSProperties = {
  ...radioStyle,
  borderColor: "var(--accent, #215e4e)",
};

const radioDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "var(--accent, #215e4e)",
};

const DIVIDER_STYLE: React.CSSProperties = { borderTop: "1px solid var(--border, #d0cdc6)", margin: "4px 0" };
const GROUPING_ITEM_STYLE: React.CSSProperties = { ...itemStyle, cursor: "pointer" };
const GROUPING_LABEL_STYLE: React.CSSProperties = { fontSize: "var(--type-small-size)", color: "var(--text-muted)" };
const DESC_STYLE: React.CSSProperties = { fontSize: "var(--type-eyebrow-size)", color: "var(--text-muted)" };
const SPACER_STYLE: React.CSSProperties = { flex: 1 };
function popoverContainerStyle(left: number, top: number): React.CSSProperties {
  return { ...popoverStyle, left, top };
}
function modeItemStyle(isActive: boolean): React.CSSProperties {
  return isActive ? { ...itemStyle, ...activeItemStyle } : itemStyle;
}
function modeLabelStyle(isActive: boolean): React.CSSProperties {
  return { fontWeight: isActive ? 600 : 400 };
}

export function CondensingPopover({
  open,
  position,
  currentMode,
  sourceCount,
  staffLabel,
  onSelectMode,
  onClose,
  onOpenStaffGrouping,
}: CondensingPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const modes: { id: CondensingMode; label: string; desc: string }[] = [
    { id: "unison", label: `a ${sourceCount}`, desc: "All sources in unison" },
    { id: "solo1", label: "1.", desc: "Solo — source 1 only" },
  ];
  if (sourceCount >= 2) {
    modes.push({ id: "solo2", label: "2.", desc: "Solo — source 2 only" });
  }
  modes.push(
    { id: "amalgamate", label: `+${sourceCount}`, desc: "Same rhythm, combined chords" },
    { id: "divisi", label: "divisi", desc: "Separate voices (stem up/down)" },
  );

  return (
    <div ref={ref} style={popoverContainerStyle(position.x, position.y)}>
      <div style={headerStyle}>{staffLabel ? `Condensing — ${staffLabel}` : "Condensing"}</div>
      {modes.map((mode) => {
        const isActive = currentMode === mode.id;
        return (
          <div
            key={mode.id}
            style={modeItemStyle(isActive)}
            onClick={() => onSelectMode(mode.id)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background =
                "color-mix(in srgb, var(--accent) 10%, transparent)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = isActive
                ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                : "";
            }}
          >
            <div style={isActive ? radioActiveStyle : radioStyle}>{isActive && <div style={radioDotStyle} />}</div>
            <span style={modeLabelStyle(isActive)}>{mode.label}</span>
            <span style={SPACER_STYLE} />
            <span style={DESC_STYLE}>{mode.desc}</span>
          </div>
        );
      })}
      {onOpenStaffGrouping && (
        <>
          <div style={DIVIDER_STYLE} />
          <div
            style={GROUPING_ITEM_STYLE}
            onClick={() => {
              onOpenStaffGrouping();
              onClose();
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background =
                "color-mix(in srgb, var(--accent) 10%, transparent)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "";
            }}
          >
            <span style={GROUPING_LABEL_STYLE}>Staff grouping…</span>
          </div>
        </>
      )}
    </div>
  );
}
