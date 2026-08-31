import { useCallback, useEffect, useState, type CSSProperties } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Button, PanelActionButton } from "@viritura/ui";
import {
  useClipboardHistoryStore,
  clearClipboardHistory,
  type ClipboardHistoryEntry,
} from "../store/clipboardHistoryStore";
import { ClipboardPreview } from "./ClipboardPreview";
import { serializeFragment } from "../clipboard/serialize";
import { UndoHistorySection } from "./UndoHistorySection";
import { useHistoryStore } from "../store/historyStore";
import { Check } from "lucide-react";
import styles from "./ClipboardHistoryPanel.module.css";

/**
 * Combined "Clips" panel:
 *  - Top section: undo history stack (Photoshop-style click-to-jump).
 *  - Bottom section: clipboard fragments. Click an entry to restore that
 *    fragment to the system clipboard so the user can Ctrl+V it anywhere.
 */
export function ClipboardHistoryPanel() {
  const entries = useClipboardHistoryStore((s) => s.entries);
  const clearHistory = clearClipboardHistory;
  const historyCount = useHistoryStore((s) => s.entries.length);

  return (
    <div className={styles.clipsContainer}>
      <section className={`${styles.section} ${styles.sectionHistory} viritura-scroll`}>
        <header className={styles.sectionHeader}>
          <span>Undo History</span>
          <span className={styles.sectionCount}>{historyCount}</span>
        </header>
        <UndoHistorySection />
      </section>

      <section className={`${styles.section} ${styles.sectionClips} viritura-scroll`}>
        <header className={styles.sectionHeader}>
          <span>Clipboard</span>
          {entries.length > 0 && (
            <PanelActionButton onClick={clearHistory} tooltip="Clear clipboard history">
              Clear
            </PanelActionButton>
          )}
        </header>
        {/* TooltipProvider at this level so hover previews share one instance */}
        <Tooltip.Provider delayDuration={280} skipDelayDuration={0}>
          <ClipboardListBody entries={entries} />
        </Tooltip.Provider>
      </section>
    </div>
  );
}

function ClipboardListBody({ entries }: { entries: readonly ClipboardHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div style={emptyStyle}>
        No clipboard entries yet.
        <br />
        Copy some notes to see them here.
      </div>
    );
  }

  return (
    <div className="viritura-scroll" style={listStyle}>
      {entries.map((entry) => (
        <ClipboardHistoryItem key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

interface ClipboardHistoryItemProps {
  entry: ClipboardHistoryEntry;
}

function ClipboardHistoryItem({ entry }: ClipboardHistoryItemProps) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  // Auto-clear "Copied!" indicator
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);

  const handleRestore = useCallback(async () => {
    const json = serializeFragment(
      entry.fragment.content,
      entry.fragment.timeSignature,
      entry.fragment.keySignature,
      entry.fragment.tracks,
    );
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      // Clipboard write may fail (insecure context, permissions). Silent for now.
    }
  }, [entry.fragment]);

  const timeAgo = formatTimeAgo(entry.timestamp);

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          className={copied ? styles.copiedFlash : undefined}
          style={clipboardItemRowStyle(hovered)}
          onClick={handleRestore}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <ClipboardPreview fragment={entry.fragment} source={entry.source} height={62} />
          <div style={metaStyle}>
            <span style={summaryStyle}>{entry.summary}</span>
            <span style={timeStyle}>
              {copied ? (
                <span style={copiedLabelStyle}>
                  <Check size={10} /> Copied
                </span>
              ) : (
                timeAgo
              )}
            </span>
          </div>
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={8}
          align="start"
          style={tooltipContentStyle}
          role="tooltip"
          aria-label="Enlarged clipboard preview"
        >
          <ClipboardPreview fragment={entry.fragment} source={entry.source} width={440} height={180} />
          <div style={popoverFooterStyle}>{entry.summary}</div>
          <Tooltip.Arrow style={tooltipArrowStyle} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ═══════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "6px 10px 12px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const emptyStyle: CSSProperties = {
  padding: "24px 16px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  lineHeight: 1.6,
};

function clipboardItemRowStyle(hovered: boolean): CSSProperties {
  return hovered ? { ...itemStyle, ...itemHoverStyle } : itemStyle;
}

const itemStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: "6px 8px",
  border: "1px solid rgba(20, 20, 28, 0.06)",
  borderRadius: "8px",
  background: "rgba(255, 255, 255, 0.30)",
  boxShadow: "none",
  cursor: "pointer",
  textAlign: "left",
  transition: "box-shadow 0.12s, background 0.12s, border-color 0.12s",
  width: "100%",
};

const itemHoverStyle: CSSProperties = {
  boxShadow: "0 2px 8px rgba(20, 20, 28, 0.10)",
  background: "rgba(255, 255, 255, 0.55)",
  borderColor: "rgba(20, 20, 28, 0.12)",
};

const metaStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0 2px",
};

const summaryStyle: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text)",
  fontWeight: "var(--type-control-weight)",
};

const timeStyle: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
};

const copiedLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "3px",
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--accent, #16a34a)",
  fontWeight: "var(--type-heading-weight)",
};

const tooltipContentStyle: CSSProperties = {
  padding: "12px",
  background: "var(--surface-raised, #fafafa)",
  borderRadius: "10px",
  boxShadow: "0 12px 32px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12)",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  zIndex: 1000,
  width: 464,
};

const tooltipArrowStyle: CSSProperties = {
  fill: "var(--surface-raised, #fafafa)",
};

const popoverFooterStyle: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  fontWeight: "var(--type-control-weight)",
  textAlign: "center",
};
