import { useCallback, useEffect, useMemo, type CSSProperties } from "react";
import { useHistoryStore, type HistoryEntry } from "../store/historyStore";
import { Undo2, Redo2 } from "lucide-react";
import { ListRow } from "@viritura/ui";

/**
 * Photoshop-style undo history panel.
 *
 * Each row is one history entry; click jumps the editor state to that point.
 * Descriptions are computed lazily by the store — entries with a pending
 * description show a shimmer placeholder.
 */
export function UndoHistorySection() {
  const entries = useHistoryStore((s) => s.entries);
  const currentIndex = useHistoryStore((s) => s.currentIndex);
  const jumpTo = useHistoryStore((s) => s.jumpTo);
  const resolveDescription = useHistoryStore((s) => s.resolveDescription);

  // Render newest first, but keep the original index for jump dispatch.
  const reversed = useMemo(() => {
    return entries.map((entry, index) => ({ entry, index })).reverse();
  }, [entries]);

  // Resolve any visible-but-pending entries on mount / when entries change.
  // Spread across microtasks to avoid blocking initial paint when the panel
  // first opens after a long editing session.
  useEffect(() => {
    const pending: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i]?.descriptionResolved) pending.push(i);
    }
    if (pending.length === 0) return;
    let cancelled = false;
    const tick = (offset: number) => {
      if (cancelled) return;
      const batch = pending.slice(offset, offset + 4);
      for (const idx of batch) resolveDescription(idx);
      if (offset + 4 < pending.length) {
        queueMicrotask(() => tick(offset + 4));
      }
    };
    tick(0);
    return () => {
      cancelled = true;
    };
  }, [entries, resolveDescription]);

  if (entries.length === 0) {
    return <div style={emptyStyle}>No history yet.</div>;
  }

  return (
    <div style={listStyle}>
      {reversed.map(({ entry, index }) => (
        <HistoryRow
          key={index}
          entry={entry}
          index={index}
          isCurrent={index === currentIndex}
          isFuture={index > currentIndex}
          onJump={() => jumpTo(index)}
        />
      ))}
    </div>
  );
}

interface HistoryRowProps {
  entry: HistoryEntry;
  index: number;
  isCurrent: boolean;
  isFuture: boolean;
  onJump: () => void;
}

function HistoryRow({ entry, index, isCurrent, isFuture, onJump }: HistoryRowProps) {
  const handleClick = useCallback(() => {
    if (!isCurrent) onJump();
  }, [isCurrent, onJump]);

  const labelText = entry.descriptionResolved ? cleanDescription(entry.description) : null;
  const timeLabel = formatHistoryTime(entry.timestamp);

  return (
    <ListRow
      density="compact"
      selected={isCurrent}
      onClick={handleClick}
      tooltip={isCurrent ? "Current state" : isFuture ? `Redo to step ${index}` : `Undo to step ${index}`}
      style={isFuture ? rowFutureStyle : undefined}
      leading={
        <span aria-hidden="true" style={iconStyle}>
          {isCurrent ? "●" : isFuture ? <Redo2 size={11} /> : <Undo2 size={11} />}
        </span>
      }
      trailing={
        <span style={historyMetaStyle}>
          <span>{timeLabel}</span>
          {isCurrent && <span style={nowBadgeStyle}>NOW</span>}
        </span>
      }
    >
      {labelText !== null ? (
        <span style={labelStyle}>{labelText}</span>
      ) : (
        <span style={shimmerStyle} aria-label="Computing description" />
      )}
    </ListRow>
  );
}

function formatHistoryTime(timestamp: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Strip the "Edit:" / "Structure:" prefix from synthesized commit messages. */
function cleanDescription(desc: string): string {
  if (!desc) return "Edit";
  const m = /^(Edit|Structure|Layout):\s*(.+)$/.exec(desc);
  if (m && m[2]) return m[2];
  return desc;
}

// ═══════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  padding: "4px 10px 8px",
};

const emptyStyle: CSSProperties = {
  padding: "16px 12px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
};

const rowFutureStyle: CSSProperties = {
  opacity: 0.55,
  fontStyle: "italic",
};

const iconStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "14px",
  flexShrink: 0,
  color: "var(--text-muted)",
};

const labelStyle: CSSProperties = {
  display: "block",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const shimmerStyle: CSSProperties = {
  display: "inline-block",
  width: "70%",
  height: "10px",
  borderRadius: "3px",
  background: "linear-gradient(90deg, var(--surface-raised) 25%, var(--surface-hover) 50%, var(--surface-raised) 75%)",
  backgroundSize: "200% 100%",
  animation: "viritura-clips-shimmer 1.2s ease-in-out infinite",
};

const nowBadgeStyle: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  letterSpacing: "0.08em",
  color: "rgb(var(--accent-rgb, 33, 94, 78))",
  padding: "2px 6px",
  borderRadius: "999px",
  background: "rgba(var(--accent-rgb, 33, 94, 78), 0.16)",
  border: "1px solid rgba(var(--accent-rgb, 33, 94, 78), 0.30)",
};

const historyMetaStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  whiteSpace: "nowrap",
};
