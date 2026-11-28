import { formatPageSizeLabel, formatStaffSizeLabel } from "@viritura/core";
import { Button, Checkbox, Panel, PanelActionButton } from "@viritura/ui";
import styles from "../PublishView.module.css";
import type { CSSProperties } from "react";
import type { LayoutEntry } from "./layoutEntries";
import { isLayoutFormat, type ExportFormat } from "./audioFormats";

interface LeftLayoutsPanelProps {
  layouts: LayoutEntry[];
  selectedIndices: Set<number>;
  focusedIndex: number | null;
  exporting: boolean;
  format: ExportFormat;
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
  /** Open a layout's page and style settings in Engrave. */
  onEditLayout?: (i: number) => void;
  /** Injected by WorkspaceShell via cloneElement — forward to inner Panel. */
  shellStyle?: CSSProperties;
}

export function LeftLayoutsPanel({
  layouts,
  selectedIndices,
  focusedIndex,
  exporting,
  format,
  width,
  onResize,
  onCollapse,
  onToggleIndex,
  onSelectAll,
  onClearSelection,
  onFocusIndex,
  onEditLayout,
  shellStyle,
}: LeftLayoutsPanelProps) {
  const wholeDocument = !isLayoutFormat(format);
  const exportLabel = format === "midi" ? "MIDI" : "Audio";
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
      subtitle={
        wholeDocument
          ? `${exportLabel} export includes the whole document.`
          : "Pick which layouts to include in the export."
      }
      actions={
        <>
          <PanelActionButton onClick={onSelectAll} disabled={!layouts.length || exporting || wholeDocument}>
            All
          </PanelActionButton>
          <PanelActionButton onClick={onClearSelection} disabled={!layouts.length || exporting || wholeDocument}>
            None
          </PanelActionButton>
        </>
      }
      scrollBody
      footer={
        <>
          Page size, staff size, and house style are set in <strong>Engrave</strong>.
        </>
      }
    >
      {layouts.length === 0 ? (
        <div className={styles.previewEmpty}>
          {wholeDocument
            ? `Layouts are not required for ${format === "midi" ? "MIDI" : "audio"} export.`
            : "No score loaded."}
        </div>
      ) : (
        <div className={styles.layoutList}>
          {layouts.map((l) => (
            <LayoutCard
              key={l.index}
              layout={l}
              checked={selectedIndices.has(l.index)}
              focused={focusedIndex === l.index}
              exporting={exporting || wholeDocument}
              onToggle={() => onToggleIndex(l.index)}
              onFocus={() => onFocusIndex(l.index)}
              onEdit={onEditLayout && (() => onEditLayout(l.index))}
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
  onEdit: (() => void) | undefined;
}

function LayoutCard({ layout, checked, focused, exporting, onToggle, onFocus, onEdit }: LayoutCardProps) {
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
          {layout.customCount > 0 && <span className={styles.customBadge}>{layout.customCount} custom</span>}
        </span>
      </div>
      {onEdit && (
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="xs" variant="ghost" ariaLabel={`Edit ${layout.name} in Engrave`} onClick={onEdit}>
            Edit
          </Button>
        </span>
      )}
    </div>
  );
}
