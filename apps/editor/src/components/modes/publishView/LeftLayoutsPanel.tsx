import { formatPageSizeLabel, formatStaffSizeLabel } from "@viritura/core";
import { Checkbox, Panel, PanelActionButton } from "@viritura/ui";
import styles from "../PublishView.module.css";
import type { CSSProperties } from "react";
import type { LayoutEntry } from "./layoutEntries";

interface LeftLayoutsPanelProps {
  layouts: LayoutEntry[];
  selectedIndices: Set<number>;
  focusedIndex: number | null;
  exporting: boolean;
  /** Panel positioning props — surfaced here so WorkspaceShell can detect
   * this wrapper as Panel-like and inject `shellStyle`. */
  side?: "left";
  width: number;
  onResize: (w: number) => void;
  onCollapse: () => void;
  onToggleIndex: (i: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onFocusIndex: (i: number) => void;
  /** Injected by WorkspaceShell via cloneElement — forward to inner Panel. */
  shellStyle?: CSSProperties;
}

export function LeftLayoutsPanel({
  layouts,
  selectedIndices,
  focusedIndex,
  exporting,
  width,
  onResize,
  onCollapse,
  onToggleIndex,
  onSelectAll,
  onClearSelection,
  onFocusIndex,
  shellStyle,
}: LeftLayoutsPanelProps) {
  return (
    <Panel
      side="left"
      width={width}
      onResize={onResize}
      min={240}
      max={480}
      onCollapse={onCollapse}
      shellStyle={shellStyle}
      title="Layouts"
      subtitle="Pick which layouts to include in the export."
      actions={
        <>
          <PanelActionButton onClick={onSelectAll} disabled={!layouts.length || exporting}>
            All
          </PanelActionButton>
          <PanelActionButton onClick={onClearSelection} disabled={!layouts.length || exporting}>
            None
          </PanelActionButton>
        </>
      }
      scrollBody
      footer={
        <>
          Edit page setup from <strong>Engrave</strong> mode (right-click a score row).
        </>
      }
    >
      {layouts.length === 0 ? (
        <div className={styles.previewEmpty}>No score loaded.</div>
      ) : (
        <div className={styles.layoutList}>
          {layouts.map((l) => (
            <LayoutCard
              key={l.index}
              layout={l}
              checked={selectedIndices.has(l.index)}
              focused={focusedIndex === l.index}
              exporting={exporting}
              onToggle={() => onToggleIndex(l.index)}
              onFocus={() => onFocusIndex(l.index)}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

interface LayoutCardProps {
  layout: LayoutEntry;
  checked: boolean;
  focused: boolean;
  exporting: boolean;
  onToggle: () => void;
  onFocus: () => void;
}

function LayoutCard({ layout, checked, focused, exporting, onToggle, onFocus }: LayoutCardProps) {
  const ps = layout.pageSetup;
  return (
    <div
      className={[styles.layoutCard, focused ? styles.layoutCardFocused : ""].filter(Boolean).join(" ")}
      onClick={onFocus}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFocus();
        }
      }}
    >
      {/* Wrapping span stops the label's bubbling click from re-triggering
          the parent layout card's onClick (which would steal focus). */}
      <span onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={checked}
          onChange={onToggle}
          disabled={exporting}
          aria-label={`Include ${layout.name} in export`}
        />
      </span>
      <div className={styles.layoutCardBody}>
        <span className={styles.layoutName}>{layout.name}</span>
        <span className={styles.layoutMeta}>
          {formatPageSizeLabel(ps.width, ps.height)}
          {" · "}
          {formatStaffSizeLabel(ps.spatiumMm)}
          {layout.hasOverride && <span className={styles.customBadge}>custom</span>}
        </span>
      </div>
    </div>
  );
}
