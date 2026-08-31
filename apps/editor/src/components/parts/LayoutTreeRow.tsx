import type React from "react";
import type { CSSProperties } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Tooltip } from "@viritura/ui";
import type { Score, LayoutGroup, LayoutStaff } from "@viritura/core";
import type { PartDisplayInfo } from "@viritura/core";
import { EditGroupInline } from "./EditGroupInline";
import { BAR_COL_WIDTH, activeEntryStyle, dropIndicatorStyle, entryStyle } from "./styles";
import type { FlatRowData, BarCell } from "./treeFlatten";
import type { NodePath } from "./treeOps";
import { pathsEqual, firstPartId, countStaves } from "./treeOps";

const ROW_STRETCH_STYLE: CSSProperties = { display: "flex", alignItems: "stretch" };
const COLLAPSED_GROUP_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  padding: "3px 4px",
  cursor: "pointer",
  fontStyle: "italic",
};
const EMPTY_GROUP_STYLE: CSSProperties = {
  padding: "4px 8px",
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  fontStyle: "italic",
  border: "1px dashed var(--border)",
  borderRadius: 4,
  textAlign: "center",
};
const GROUP_EDITING_WRAP_STYLE: CSSProperties = { marginBottom: 2 };
const CHEVRON_STYLE: CSSProperties = { color: "var(--text-muted)", flexShrink: 0 };
const STAFF_NAME_STYLE: CSSProperties = { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const CONDENSED_BADGE_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--accent, #215e4e)",
  flexShrink: 0,
  padding: "0 4px",
  borderRadius: 3,
  background: "color-mix(in srgb, var(--accent, #215e4e) 15%, transparent)",
};
const DOUBLINGS_WRAP_STYLE: CSSProperties = { paddingLeft: 8 };
function rowDraggingStyle(isDragging: boolean): CSSProperties {
  return { opacity: isDragging ? 0.4 : 1 };
}
function rowContentStyle(gapAbove: boolean | undefined): CSSProperties {
  return { flex: 1, minWidth: 0, paddingTop: gapAbove ? 8 : 0 };
}
function gutterEmptyStyle(rowGapAbove: boolean | undefined): CSSProperties {
  return { width: BAR_COL_WIDTH, flexShrink: 0, paddingTop: rowGapAbove ? 8 : 0 };
}
function gutterBarOuterStyle(cell: BarCell, rowGapAbove: boolean | undefined): CSSProperties {
  return {
    width: BAR_COL_WIDTH,
    flexShrink: 0,
    display: "flex",
    justifyContent: "center",
    cursor: "pointer",
    paddingTop: cell.gapAbove || (rowGapAbove && (cell.position === "first" || cell.position === "only")) ? 8 : 0,
  };
}
function gutterBarInnerStyle(cell: BarCell, isGroupSelected: boolean, isGroupDropTarget: boolean): CSSProperties {
  return {
    width: 3,
    background: isGroupSelected
      ? `color-mix(in srgb, ${cell.color} 60%, var(--accent))`
      : isGroupDropTarget
        ? "var(--accent)"
        : cell.color,
    borderRadius:
      cell.position === "only"
        ? 2
        : cell.position === "first"
          ? "2px 2px 0 0"
          : cell.position === "last"
            ? "0 0 2px 2px"
            : 0,
    transition: "background 0.15s",
  };
}
function staffRowStyle(canEdit: boolean, isSelected: boolean, isNodeSelected: boolean): CSSProperties {
  return {
    ...entryStyle,
    paddingLeft: 4,
    display: "flex",
    alignItems: "center",
    gap: 4,
    cursor: canEdit ? "grab" : "pointer",
    ...(isSelected ? activeEntryStyle : {}),
    ...(isNodeSelected ? { background: "color-mix(in srgb, var(--accent) 15%, transparent)" } : {}),
  };
}
function sourceRowStyle(isSrcSelected: boolean): CSSProperties {
  return {
    ...entryStyle,
    paddingLeft: 4,
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: "var(--type-eyebrow-size)",
    cursor: "pointer",
    ...(isSrcSelected ? activeEntryStyle : {}),
  };
}

interface DragState {
  path: NodePath;
}

interface DropTarget {
  path: NodePath;
  position: "before" | "after" | "inside";
}

function getPartDisplayName(displayMap: Map<string, PartDisplayInfo>, partId: string): string {
  return displayMap.get(partId)?.displayName ?? partId;
}

export interface LayoutTreeRowProps {
  row: FlatRowData;
  score: Score;
  dragState: DragState | null;
  dropTarget: DropTarget | null;
  selectedPaths: Set<string>;
  canEdit: boolean;
  partIdToScoreIndex: Map<string, number>;
  selectedScoreIndex: number;
  expandedDoublings: Set<string>;
  editingGroupLabel: string;
  partDisplayMap: Map<string, PartDisplayInfo>;
  onSelectScore: (index: number) => void;
  onDragStart: (path: NodePath) => void;
  onDragOver: (e: React.DragEvent, path: NodePath, type: "staff" | "group") => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
  onToggleCollapse: (pathKey: string) => void;
  onToggleDoublingCollapse: (pathKey: string) => void;
  onGroupContextMenu: (e: React.MouseEvent, node: LayoutGroup, path: NodePath) => void;
  onStaffContextMenu: (e: React.MouseEvent, partId: string, path: NodePath, depth: number) => void;
  onNodeClick: (e: React.MouseEvent, path: NodePath) => void;
  onEditGroup: (pathKey: string | null) => void;
  onUpdateGroupProp: (path: NodePath, prop: "symbol" | "label", value: string) => void;
  onEditGroupLabel: (label: string) => void;
}

export function LayoutTreeRow({
  row,
  score,
  dragState,
  dropTarget,
  selectedPaths,
  canEdit,
  partIdToScoreIndex,
  selectedScoreIndex,
  expandedDoublings,
  editingGroupLabel,
  partDisplayMap,
  onSelectScore,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onToggleCollapse,
  onToggleDoublingCollapse,
  onGroupContextMenu,
  onStaffContextMenu,
  onNodeClick,
  onEditGroup,
  onUpdateGroupProp,
  onEditGroupLabel,
}: LayoutTreeRowProps) {
  const pathKey = row.path.join("-");

  const isRowDragging =
    !!dragState &&
    (pathsEqual(dragState.path, row.path) ||
      row.barCells.some((cell) => cell && pathsEqual(cell.groupPath, dragState.path)));

  const isDropBefore = !!dropTarget && pathsEqual(dropTarget.path, row.path) && dropTarget.position === "before";
  const isDropAfter = !!dropTarget && pathsEqual(dropTarget.path, row.path) && dropTarget.position === "after";

  return (
    <div style={rowDraggingStyle(isRowDragging)}>
      {isDropBefore && <div style={dropIndicatorStyle} />}

      <div style={ROW_STRETCH_STYLE}>
        {/* Bar columns — sub-groups on the left, parents on the right */}
        {row.barCells.map((cell, col) => (
          <GutterBar
            key={col}
            cell={cell}
            rowGapAbove={row.gapAbove}
            selectedPaths={selectedPaths}
            dropTarget={dropTarget}
            canEdit={canEdit}
            onNodeClick={onNodeClick}
            onToggleCollapse={onToggleCollapse}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onGroupContextMenu={onGroupContextMenu}
          />
        ))}

        {/* Content */}
        <div style={rowContentStyle(row.gapAbove)}>
          {row.type === "staff" && (
            <StaffRow
              node={row.node as LayoutStaff}
              path={row.path}
              depth={row.depth}
              partIdToScoreIndex={partIdToScoreIndex}
              selectedScoreIndex={selectedScoreIndex}
              expandedDoublings={expandedDoublings}
              isNodeSelected={selectedPaths.has(pathKey)}
              canEdit={canEdit}
              partDisplayMap={partDisplayMap}
              onSelectScore={onSelectScore}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              onToggleDoublingCollapse={onToggleDoublingCollapse}
              onStaffContextMenu={onStaffContextMenu}
              onNodeClick={onNodeClick}
            />
          )}
          {row.type === "collapsed-group" &&
            (() => {
              const group = row.node as LayoutGroup;
              const symbolName =
                (group.symbol ?? "bracket").charAt(0).toUpperCase() + (group.symbol ?? "bracket").slice(1);
              const total = countStaves(group.content);
              let label: string;
              if (group.label) {
                label = group.label;
              } else {
                const fId = firstPartId(group.content);
                const firstName = fId ? (score.parts.find((p) => p.id === fId)?.name ?? fId) : "";
                const remaining = total - 1;
                label = `${symbolName} group \u00b7 ${firstName}${remaining > 0 ? ` (+${remaining})` : ""}`;
              }
              return (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(pathKey);
                  }}
                  onDragOver={(e) => onDragOver(e, row.path, "group")}
                  onDrop={onDrop}
                  style={COLLAPSED_GROUP_STYLE}
                >
                  {label} {"\u203a"}
                </div>
              );
            })()}
          {row.type === "empty-group" && (
            <div onDragOver={(e) => onDragOver(e, row.path, "group")} onDrop={onDrop} style={EMPTY_GROUP_STYLE}>
              Drop staves here
            </div>
          )}
          {row.type === "group-editing" && (
            <div style={GROUP_EDITING_WRAP_STYLE}>
              <EditGroupInline
                label={editingGroupLabel}
                symbol={(row.node as LayoutGroup).symbol ?? "bracket"}
                onLabelChange={onEditGroupLabel}
                onSymbolChange={(v) => onUpdateGroupProp(row.path, "symbol", v)}
                onConfirm={() => {
                  onUpdateGroupProp(row.path, "label", editingGroupLabel);
                  onEditGroup(null);
                }}
                onCancel={() => onEditGroup(null)}
              />
            </div>
          )}
        </div>
      </div>

      {isDropAfter && <div style={dropIndicatorStyle} />}
    </div>
  );
}

// ─── Gutter bar ─────────────────────────────────────────────────

interface GutterBarProps {
  cell: BarCell | null;
  rowGapAbove: boolean | undefined;
  selectedPaths: Set<string>;
  dropTarget: DropTarget | null;
  canEdit: boolean;
  onNodeClick: (e: React.MouseEvent, path: NodePath) => void;
  onToggleCollapse: (pathKey: string) => void;
  onDragStart: (path: NodePath) => void;
  onDragEnd: () => void;
  onGroupContextMenu: (e: React.MouseEvent, node: LayoutGroup, path: NodePath) => void;
}

function GutterBar({
  cell,
  rowGapAbove,
  selectedPaths,
  dropTarget,
  canEdit,
  onNodeClick,
  onToggleCollapse,
  onDragStart,
  onDragEnd,
  onGroupContextMenu,
}: GutterBarProps) {
  if (!cell) {
    return <div style={gutterEmptyStyle(rowGapAbove)} />;
  }
  const isGroupSelected = selectedPaths.has(cell.groupPath.join("-"));
  const isGroupDropTarget =
    !!dropTarget && pathsEqual(dropTarget.path, cell.groupPath) && dropTarget.position === "inside";
  const displayLabel =
    cell.groupNode.label ||
    `${(cell.groupNode.symbol ?? "bracket").charAt(0).toUpperCase() + (cell.groupNode.symbol ?? "bracket").slice(1)} group`;
  return (
    <Tooltip content={displayLabel}>
      <div
        draggable={canEdit}
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart(cell.groupPath);
        }}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          e.stopPropagation();
          onNodeClick(e, cell.groupPath);
          if (!e.shiftKey) onToggleCollapse(cell.groupPath.join("-"));
        }}
        onContextMenu={
          canEdit
            ? (e) => {
                e.stopPropagation();
                onGroupContextMenu(e, cell.groupNode, cell.groupPath);
              }
            : undefined
        }
        style={gutterBarOuterStyle(cell, rowGapAbove)}
      >
        <div style={gutterBarInnerStyle(cell, isGroupSelected, isGroupDropTarget)} />
      </div>
    </Tooltip>
  );
}

// ─── Staff row ──────────────────────────────────────────────────

interface StaffRowProps {
  node: LayoutStaff;
  path: NodePath;
  depth: number;
  partIdToScoreIndex: Map<string, number>;
  selectedScoreIndex: number;
  expandedDoublings: Set<string>;
  isNodeSelected: boolean;
  canEdit: boolean;
  partDisplayMap: Map<string, PartDisplayInfo>;
  onSelectScore: (index: number) => void;
  onDragStart: (path: NodePath) => void;
  onDragOver: (e: React.DragEvent, path: NodePath, type: "staff" | "group") => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
  onToggleDoublingCollapse: (pathKey: string) => void;
  onStaffContextMenu: (e: React.MouseEvent, partId: string, path: NodePath, depth: number) => void;
  onNodeClick: (e: React.MouseEvent, path: NodePath) => void;
}

function StaffRow({
  node,
  path,
  depth,
  partIdToScoreIndex,
  selectedScoreIndex,
  expandedDoublings,
  isNodeSelected,
  canEdit,
  partDisplayMap,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onToggleDoublingCollapse,
  onStaffContextMenu,
  onNodeClick,
}: StaffRowProps) {
  const partId = node.sources?.[0]?.part ?? "";
  const staffNum = node.sources?.[0]?.staff;
  const scoreIndex = partIdToScoreIndex.get(partId);
  const partName = getPartDisplayName(partDisplayMap, partId);
  const displayName = staffNum != null ? `${partName} (staff ${staffNum})` : partName;
  const isSelected = scoreIndex !== undefined && scoreIndex === selectedScoreIndex;
  const pathKey = path.join("-");
  const hasDoublings = node.sources.length > 1;
  const isDoublingExpanded = expandedDoublings.has(pathKey);
  const combinedName = hasDoublings
    ? node.sources.map((s) => getPartDisplayName(partDisplayMap, s.part)).join(" / ")
    : displayName;

  return (
    <>
      <Tooltip content={combinedName}>
        <div
          draggable={canEdit}
          onDragStart={(e) => {
            e.stopPropagation();
            onDragStart(path);
          }}
          onDragOver={(e) => onDragOver(e, path, "staff")}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
          onClick={(e) => {
            e.stopPropagation();
            onNodeClick(e, path);
            if (hasDoublings && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              onToggleDoublingCollapse(pathKey);
            }
          }}
          onContextMenu={canEdit ? (e) => onStaffContextMenu(e, partId, path, depth) : undefined}
          className="parts-row"
          style={staffRowStyle(canEdit, isSelected, isNodeSelected)}
        >
          {hasDoublings &&
            (isDoublingExpanded ? (
              <ChevronDown size={12} style={CHEVRON_STYLE} />
            ) : (
              <ChevronRight size={12} style={CHEVRON_STYLE} />
            ))}
          <span style={STAFF_NAME_STYLE}>{hasDoublings ? combinedName : displayName}</span>
          {hasDoublings && <span style={CONDENSED_BADGE_STYLE}>condensed</span>}
        </div>
      </Tooltip>

      {/* Expanded doubling sub-items */}
      {hasDoublings && isDoublingExpanded && (
        <div style={DOUBLINGS_WRAP_STYLE}>
          {node.sources.map((src, idx) => {
            const srcPartName = getPartDisplayName(partDisplayMap, src.part);
            const srcScoreIndex = partIdToScoreIndex.get(src.part);
            const isSrcSelected = srcScoreIndex !== undefined && srcScoreIndex === selectedScoreIndex;
            return (
              <Tooltip key={`${src.part}-${idx}`} content={srcPartName}>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onContextMenu={canEdit ? (e) => onStaffContextMenu(e, src.part, path, depth) : undefined}
                  style={sourceRowStyle(isSrcSelected)}
                >
                  <span style={STAFF_NAME_STYLE}>{srcPartName}</span>
                </div>
              </Tooltip>
            );
          })}
        </div>
      )}
    </>
  );
}
