import { memo, useCallback, useEffect, useMemo, type CSSProperties } from "react";
import { useHistoryStore, useHistoryStoreInstance, type HistoryEntry } from "../store/historyStore";
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
  const store = useHistoryStoreInstance();
  const onJump = useCallback(
    (id: number) => {
      const index = store.getState().entries.findIndex((entry) => entry.id === id);
      if (index >= 0) jumpTo(index);
    },
    [jumpTo, store],
  );

  // Render newest first. Stable entry ids let rows retain identity as the
  // bounded history drops its oldest entry.
  const reversed = useMemo(() => {
    return entries.map((entry, index) => ({ entry, index })).reverse();
  }, [entries]);

  // Resolve newest first, yielding between entries so the browser can paint
  // and handle input even when a full stack needs semantic descriptions.
  useEffect(() => {
    const pending = entries.findLast((entry) => !entry.descriptionResolved);
    if (!pending) return;
    const timer = window.setTimeout(() => {
      const state = store.getState();
      const index = state.entries.findIndex((entry) => entry.id === pending.id);
      if (index >= 0) state.resolveDescription(index);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [entries, store]);

  if (entries.length === 0) {
    return <div style={emptyStyle}>No history yet.</div>;
  }

  return (
    <div style={listStyle}>
      {reversed.map(({ entry, index }) => (
        <HistoryRow
          key={entry.id}
          id={entry.id}
          description={entry.description}
          descriptionResolved={entry.descriptionResolved}
          timeLabel={formatHistoryTime(entry.timestamp)}
          isCurrent={index === currentIndex}
          isFuture={index > currentIndex}
          onJump={onJump}
        />
      ))}
    </div>
  );
}

interface HistoryRowProps {
  id: HistoryEntry["id"];
  description: HistoryEntry["description"];
  descriptionResolved: HistoryEntry["descriptionResolved"];
  timeLabel: string;
  isCurrent: boolean;
  isFuture: boolean;
  onJump: (id: number) => void;
}

const HistoryRow = memo(function HistoryRow({
  id,
  description,
  descriptionResolved,
  timeLabel,
  isCurrent,
  isFuture,
  onJump,
}: HistoryRowProps) {
  const handleClick = useCallback(() => {
    if (!isCurrent) onJump(id);
  }, [id, isCurrent, onJump]);

  const labelText = descriptionResolved ? cleanDescription(description) : null;

  return (
    <ListRow
      density="compact"
      selected={isCurrent}
      onClick={handleClick}
      tooltip={isCurrent ? "Current state" : isFuture ? "Redo to this state" : "Undo to this state"}
      style={isFuture ? rowFutureStyle : undefined}
      leading={
        <span aria-hidden="true" style={iconStyle}>
          {isCurrent ? "●" : isFuture ? <Redo2 size={11} /> : <Undo2 size={11} />}
        </span>
      }
      trailing={
        <span style={historyMetaStyle}>
          {!isCurrent && <span>{timeLabel}</span>}
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
});

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
