import { Fragment, type CSSProperties } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { Score, ScoreDefinition, LayoutDefinition, PartDisplayInfo } from "@viritura/core";
import { Button, FormInput, type ContextMenuState, type MenuItemDef } from "@viritura/ui";
import { collectPartIdsInLayout } from "../../score/ScoreMutations";
import { LayoutTreeRow } from "./LayoutTreeRow";
import type { FlatRowData } from "./treeFlatten";
import type { NodePath } from "./treeOps";
import { partsSectionDividerStyle, scoreHeaderStyle, scoreHeaderActiveStyle } from "./styles";

interface DragState {
  path: NodePath;
}

interface DropTarget {
  path: NodePath;
  position: "before" | "after" | "inside";
}

export interface ScoreListItemProps {
  // identity
  index: number;
  sd: ScoreDefinition;
  isSelected: boolean;
  isExpandable: boolean;
  isCollapsed: boolean;
  showStaves: boolean;
  showPartsDivider: boolean;

  // shared state (read-only)
  score: Score;
  layoutContent: ReadonlyArray<LayoutDefinition["content"][number]>;
  flatRows: FlatRowData[];
  selectedScoreIndex: number;
  partIdToScoreIndex: Map<string, number>;
  partDisplayMap: Map<string, PartDisplayInfo>;
  expandedDoublings: Set<string>;
  selectedPaths: Set<string>;
  dragState: DragState | null;
  dropTarget: DropTarget | null;
  editingGroupLabel: string;

  // drag state for score reorder
  scoreDragIndex: number | null;
  scoreDropIndex: number | null;
  renamingScoreIndex: number | null;
  renamingScoreName: string;

  // callbacks
  canEdit: boolean;
  onSelectScore: (index: number) => void;
  onLayoutChange?: (layouts: LayoutDefinition[]) => void;
  onReorderScores?: (from: number, to: number) => void;
  onDeleteScore?: (index: number) => void;
  onRenameScore?: (index: number, name: string) => void;
  onDuplicateScore?: (index: number) => void;
  onResetLayout?: (index: number) => void;
  onAddInstrumentToScore?: (scoreIndex: number, partId: string) => void;
  onManageInstruments?: (scoreIndex: number) => void;
  setScoreDragIndex: (v: number | null) => void;
  setScoreDropIndex: (v: number | null) => void;
  setRenamingScoreIndex: (v: number | null) => void;
  setRenamingScoreName: (v: string) => void;
  setCollapsedScores: (updater: (prev: Set<number>) => Set<number>) => void;
  setSelectedPaths: (v: Set<string>) => void;
  setSelectionAnchor: (v: string | null) => void;
  setDropTarget: (v: DropTarget | null) => void;
  setContextMenu: (v: ContextMenuState | null) => void;
  setEditingGroup: (v: string | null) => void;
  setEditingGroupLabel: (v: string) => void;
  filterModeRef: React.RefObject<boolean>;
  toggleGroup: (pathKey: string) => void;
  toggleDoubling: (pathKey: string) => void;
  updateGroupProp: (path: NodePath, prop: "symbol" | "label", value: string) => void;
  openGroupContextMenu: (e: React.MouseEvent, node: import("@viritura/core").LayoutGroup, path: NodePath) => void;
  openStaffContextMenu: (e: React.MouseEvent, partId: string, path: NodePath, depth: number) => void;
  handleNodeClick: (e: React.MouseEvent, path: NodePath) => void;
  handleDragStart: (path: NodePath) => void;
  handleDragOver: (e: React.DragEvent, path: NodePath, type: "staff" | "group") => void;
  handleDragEnd: () => void;
  handleDrop: (e: React.DragEvent) => void;
}

const dropIndicatorOverlayStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 4,
  right: 4,
  height: 2,
  background: "var(--accent, #215e4e)",
  borderRadius: 1,
  zIndex: 10,
};

const SCORE_HEADER_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center" };
const SCORE_STAVES_WRAP_STYLE: CSSProperties = { padding: "2px 4px 4px 8px" };
const CHEVRON_DOWN_STYLE: CSSProperties = { flexShrink: 0, opacity: 0.85 };
const CHEVRON_RIGHT_STYLE: CSSProperties = { flexShrink: 0, opacity: 0.65 };
const CHEVRON_SPACER_STYLE: CSSProperties = { display: "inline-block", width: 11, flexShrink: 0 };
const SCORE_NAME_STYLE: CSSProperties = { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const SCORE_RENAME_INPUT_STYLE: CSSProperties = {
  ...scoreHeaderStyle,
  border: "1px solid var(--accent)",
  outline: "none",
  borderRadius: 6,
  padding: "4px 8px",
  flex: 1,
  textTransform: "none",
  letterSpacing: 0,
  fontSize: "var(--type-small-size)",
};
function scoreRowStyle(isDragging: boolean): CSSProperties {
  return { opacity: isDragging ? 0.4 : 1, position: "relative" };
}
function scoreHeaderButtonStyle(index: number, isSelected: boolean): CSSProperties {
  return {
    ...scoreHeaderStyle,
    ...(index === 0 ? { borderTop: "none" } : {}),
    ...(isSelected ? scoreHeaderActiveStyle : {}),
    flex: 1,
  };
}

function scoreDisplayName(sd: ScoreDefinition, index: number): string {
  return sd.name ?? (index === 0 ? "Full Score" : `Score ${index + 1}`);
}

/** Parts not yet present in this score's layout, as an "Add Instrument" submenu. */
function buildAddInstrumentSubmenu(
  i: number,
  sd: ScoreDefinition,
  score: Score,
  partDisplayMap: Map<string, PartDisplayInfo>,
  onAddInstrumentToScore: (scoreIndex: number, partId: string) => void,
): MenuItemDef | null {
  const layoutId = sd.layout ?? sd.pages?.[0]?.systems?.[0]?.layout;
  const layout = layoutId ? (score.layouts ?? []).find((l) => l.id === layoutId) : undefined;
  if (!layout) return null;
  const present = collectPartIdsInLayout(layout.content);
  const absent = score.parts.filter((p) => p.id && !present.has(p.id));
  if (absent.length === 0) return null;
  return {
    label: "Add Instrument",
    children: absent.map((p) => ({
      label: partDisplayMap.get(p.id!)?.displayName ?? p.name,
      action: () => onAddInstrumentToScore(i, p.id!),
    })),
  };
}

function buildScoreContextMenuItems(
  i: number,
  sd: ScoreDefinition,
  opts: Pick<
    ScoreListItemProps,
    | "onRenameScore"
    | "onDuplicateScore"
    | "onDeleteScore"
    | "onResetLayout"
    | "onAddInstrumentToScore"
    | "onManageInstruments"
    | "isExpandable"
    | "score"
    | "partDisplayMap"
    | "setRenamingScoreIndex"
    | "setRenamingScoreName"
  >,
): MenuItemDef[] {
  const items: MenuItemDef[] = [];
  const {
    onRenameScore,
    onDuplicateScore,
    onDeleteScore,
    onResetLayout,
    onAddInstrumentToScore,
    onManageInstruments,
    isExpandable,
    score,
    partDisplayMap,
    setRenamingScoreIndex,
    setRenamingScoreName,
  } = opts;
  if (onRenameScore) {
    items.push({
      label: "Rename",
      action: () => {
        setRenamingScoreIndex(i);
        setRenamingScoreName(scoreDisplayName(sd, i));
      },
    });
  }
  if (onDuplicateScore) items.push({ label: "Duplicate", action: () => onDuplicateScore(i) });
  // Manage which instruments this conductor score contains (multi-select
  // dialog). Single-staff part extracts are 1:1 with a part, so skip them.
  if (onManageInstruments && isExpandable) {
    if (items.length > 0) items.push({ separator: true });
    items.push({ label: "Manage Instruments…", action: () => onManageInstruments(i) });
  }
  // Add an existing instrument to this conductor score's layout. Only offered
  // for multi-staff scores; single-staff part extracts are 1:1 with a part.
  if (onAddInstrumentToScore && isExpandable) {
    const submenu = buildAddInstrumentSubmenu(i, sd, score, partDisplayMap, onAddInstrumentToScore);
    if (submenu) {
      if (items.length > 0 && !items[items.length - 1]?.separator) items.push({ separator: true });
      items.push(submenu);
    }
  }
  if (onDeleteScore && i > 0) {
    if (items.length > 0) items.push({ separator: true });
    items.push({ label: "Delete", action: () => onDeleteScore(i) });
  }
  if (onResetLayout) {
    if (items.length > 0) items.push({ separator: true });
    items.push({ label: "Reset Layout to Default", action: () => onResetLayout(i) });
  }
  return items;
}

export function ScoreListItem(props: ScoreListItemProps) {
  const {
    index: i,
    sd,
    isSelected,
    isExpandable,
    isCollapsed,
    showStaves,
    showPartsDivider,
    score,
    layoutContent,
    flatRows,
    selectedScoreIndex,
    partIdToScoreIndex,
    partDisplayMap,
    expandedDoublings,
    selectedPaths,
    dragState,
    dropTarget,
    editingGroupLabel,
    scoreDragIndex,
    scoreDropIndex,
    renamingScoreIndex,
    renamingScoreName,
    canEdit,
    onSelectScore,
    onLayoutChange,
    onReorderScores,
    onRenameScore,
    setScoreDragIndex,
    setScoreDropIndex,
    setRenamingScoreIndex,
    setRenamingScoreName,
    setCollapsedScores,
    setSelectedPaths,
    setSelectionAnchor,
    setDropTarget,
    setContextMenu,
    setEditingGroup,
    setEditingGroupLabel,
    filterModeRef,
    toggleGroup,
    toggleDoubling,
    updateGroupProp,
    openGroupContextMenu,
    openStaffContextMenu,
    handleNodeClick,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDrop,
  } = props;

  const displayName = scoreDisplayName(sd, i);
  const commitRename = () => {
    if (onRenameScore && renamingScoreName.trim()) onRenameScore(i, renamingScoreName.trim());
    setRenamingScoreIndex(null);
  };

  return (
    <Fragment>
      {showPartsDivider && (
        <div style={partsSectionDividerStyle}>
          <span>Parts</span>
        </div>
      )}
      <div
        draggable={!!onReorderScores && renamingScoreIndex !== i}
        onDragStart={(e) => {
          if (!onReorderScores) return;
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/x-score-index", String(i));
          setScoreDragIndex(i);
        }}
        onDragOver={(e) => {
          if (scoreDragIndex == null || scoreDragIndex === i) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          const rect = e.currentTarget.getBoundingClientRect();
          const y = e.clientY - rect.top;
          setScoreDropIndex(y < rect.height / 2 ? i : i + 1);
        }}
        onDragEnd={() => {
          setScoreDragIndex(null);
          setScoreDropIndex(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (scoreDragIndex != null && scoreDropIndex != null && onReorderScores) {
            const to = scoreDragIndex < scoreDropIndex ? scoreDropIndex - 1 : scoreDropIndex;
            if (scoreDragIndex !== to) onReorderScores(scoreDragIndex, to);
          }
          setScoreDragIndex(null);
          setScoreDropIndex(null);
        }}
        style={scoreRowStyle(scoreDragIndex === i)}
      >
        {scoreDropIndex === i && scoreDragIndex != null && scoreDragIndex !== i && (
          <div style={dropIndicatorOverlayStyle} />
        )}
        <div
          style={SCORE_HEADER_ROW_STYLE}
          onContextMenu={(e) => {
            e.preventDefault();
            const items = buildScoreContextMenuItems(i, sd, props);
            if (items.length > 0) setContextMenu({ x: e.clientX, y: e.clientY, items });
          }}
        >
          {renamingScoreIndex === i ? (
            <ScoreRenameInput
              value={renamingScoreName}
              onChange={setRenamingScoreName}
              onCommit={commitRename}
              onCancel={() => setRenamingScoreIndex(null)}
            />
          ) : (
            <ScoreHeaderButton
              index={i}
              displayName={displayName}
              isSelected={isSelected}
              isExpandable={isExpandable}
              isCollapsed={isCollapsed}
              onClick={() => {
                filterModeRef.current = false;
                setSelectedPaths(new Set());
                setSelectionAnchor(null);
                if (isSelected && isExpandable) {
                  setCollapsedScores((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  });
                } else {
                  if (isCollapsed) {
                    setCollapsedScores((prev) => {
                      const next = new Set(prev);
                      next.delete(i);
                      return next;
                    });
                  }
                  onSelectScore(i);
                }
              }}
            />
          )}
        </div>

        {showStaves && (
          <div
            style={SCORE_STAVES_WRAP_STYLE}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragState) {
                setDropTarget({ path: [layoutContent.length], position: "before" });
              }
            }}
            onDrop={handleDrop}
          >
            {flatRows.map((row) => (
              <LayoutTreeRow
                key={row.path.join("-") + "-" + row.type}
                row={row}
                score={score}
                dragState={dragState}
                dropTarget={dropTarget}
                selectedPaths={selectedPaths}
                canEdit={canEdit && !!onLayoutChange}
                partIdToScoreIndex={partIdToScoreIndex}
                selectedScoreIndex={selectedScoreIndex}
                expandedDoublings={expandedDoublings}
                editingGroupLabel={editingGroupLabel}
                onSelectScore={onSelectScore}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
                onToggleCollapse={toggleGroup}
                onToggleDoublingCollapse={toggleDoubling}
                onGroupContextMenu={openGroupContextMenu}
                onStaffContextMenu={openStaffContextMenu}
                onNodeClick={handleNodeClick}
                onEditGroup={setEditingGroup}
                onUpdateGroupProp={updateGroupProp}
                onEditGroupLabel={setEditingGroupLabel}
                partDisplayMap={partDisplayMap}
              />
            ))}
          </div>
        )}
      </div>
    </Fragment>
  );
}

// ───────────────────────────────────────────────────────────────────

interface ScoreRenameInputProps {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function ScoreRenameInput({ value, onChange, onCommit, onCancel }: ScoreRenameInputProps) {
  return (
    <FormInput
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") onCancel();
      }}
      style={SCORE_RENAME_INPUT_STYLE}
    />
  );
}

interface ScoreHeaderButtonProps {
  index: number;
  displayName: string;
  isSelected: boolean;
  isExpandable: boolean;
  isCollapsed: boolean;
  onClick: () => void;
}

function ScoreHeaderButton({
  index,
  displayName,
  isSelected,
  isExpandable,
  isCollapsed,
  onClick,
}: ScoreHeaderButtonProps) {
  return (
    <Button
      onClick={onClick}
      className="parts-score-header"
      style={scoreHeaderButtonStyle(index, isSelected)}
      tooltip={isExpandable ? (isSelected ? (isCollapsed ? "Expand" : "Collapse") : displayName) : displayName}
    >
      {isExpandable ? (
        isSelected && !isCollapsed ? (
          <ChevronDown size={11} style={CHEVRON_DOWN_STYLE} />
        ) : (
          <ChevronRight size={11} style={CHEVRON_RIGHT_STYLE} />
        )
      ) : (
        <span style={CHEVRON_SPACER_STYLE} />
      )}
      <span style={SCORE_NAME_STYLE}>{displayName}</span>
    </Button>
  );
}
