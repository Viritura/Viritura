import type { CSSProperties } from "react";
import type { Score, ScoreDefinition, LayoutDefinition, PartDisplayInfo } from "@viritura/core";
import type { ContextMenuState } from "@viritura/ui";

const END_DROP_INDICATOR_STYLE: CSSProperties = {
  position: "relative",
  height: 2,
  margin: "0 4px",
  background: "var(--accent, #215e4e)",
  borderRadius: 1,
};
import { ScoreListItem } from "./ScoreListItem";
import { AddScoreButton } from "./AddScoreButton";
import type { FlatRowData } from "./treeFlatten";
import type { NodePath } from "./treeOps";
import type { DragState, DropTarget } from "./usePartListLayout";

export interface ScoreListBodyProps {
  score: Score;
  visibleScores: { index: number; sd: ScoreDefinition }[];
  selectedScoreIndex: number;
  staffCountByScoreIndex: Map<number, number>;
  activeStaffCount: number;
  partsSectionStart: number;
  collapsedScores: Set<number>;
  layoutContent: import("@viritura/core").LayoutContent[];
  flatRows: FlatRowData[];
  partIdToScoreIndex: Map<string, number>;
  partDisplayMap: Map<string, PartDisplayInfo>;
  expandedDoublings: Set<string>;
  selectedPaths: Set<string>;
  dragState: DragState | null;
  dropTarget: DropTarget | null;
  editingGroupLabel: string;
  scoreDragIndex: number | null;
  scoreDropIndex: number | null;
  renamingScoreIndex: number | null;
  renamingScoreName: string;
  canEdit: boolean;
  onSelectScore: (i: number) => void;
  onLayoutChange?: (layouts: LayoutDefinition[]) => void;
  onReorderScores?: (from: number, to: number) => void;
  onDeleteScore?: (i: number) => void;
  onRenameScore?: (i: number, name: string) => void;
  onDuplicateScore?: (i: number) => void;
  onResetLayout?: (i: number) => void;
  onAddScore?: (type: "full" | "condensed" | "custom" | "part", partId?: string) => void;
  onAddSectionScore?: () => void;
  onAddInstrumentToScore?: (scoreIndex: number, partId: string) => void;
  onManageInstruments?: (scoreIndex: number) => void;
  setScoreDragIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setScoreDropIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setRenamingScoreIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setRenamingScoreName: React.Dispatch<React.SetStateAction<string>>;
  setCollapsedScores: React.Dispatch<React.SetStateAction<Set<number>>>;
  setSelectedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectionAnchor: React.Dispatch<React.SetStateAction<string | null>>;
  setDropTarget: (v: DropTarget | null) => void;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  setEditingGroup: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingGroupLabel: React.Dispatch<React.SetStateAction<string>>;
  filterModeRef: React.MutableRefObject<boolean>;
  toggleGroup: (pathKey: string) => void;
  toggleDoubling: (pathKey: string) => void;
  updateGroupProp: (path: NodePath, prop: "symbol" | "label", value: string) => void;
  openGroupContextMenu: (e: React.MouseEvent, node: import("@viritura/core").LayoutGroup, path: NodePath) => void;
  openStaffContextMenu: (e: React.MouseEvent, partId: string, path: NodePath, depth: number) => void;
  handleNodeClick: (e: React.MouseEvent, path: NodePath) => void;
  handleDragStart: (path: NodePath) => void;
  handleDragOver: (e: React.DragEvent, targetPath: NodePath, targetType: "staff" | "group") => void;
  handleDragEnd: () => void;
  handleDrop: (e: React.DragEvent) => void;
}

export function ScoreListBody(props: ScoreListBodyProps) {
  const {
    score,
    visibleScores,
    selectedScoreIndex,
    staffCountByScoreIndex,
    activeStaffCount,
    partsSectionStart,
    collapsedScores,
    partDisplayMap,
    scoreDragIndex,
    scoreDropIndex,
    onAddScore,
    onReorderScores,
    setScoreDragIndex,
    setScoreDropIndex,
  } = props;
  return (
    <>
      {visibleScores.map(({ index: i, sd }, pos) => {
        const isSelected = selectedScoreIndex === i;
        const rowStaffCount = staffCountByScoreIndex.get(i) ?? 0;
        const isExpandable = rowStaffCount > 1;
        const isCollapsed = collapsedScores.has(i);
        const showStaves = isSelected && isExpandable && !isCollapsed && activeStaffCount > 1;
        const showPartsDivider = pos === partsSectionStart;
        return (
          <ScoreListItem
            key={i}
            index={i}
            sd={sd}
            isSelected={isSelected}
            isExpandable={isExpandable}
            isCollapsed={isCollapsed}
            showStaves={showStaves}
            showPartsDivider={showPartsDivider}
            score={score}
            layoutContent={props.layoutContent}
            flatRows={props.flatRows}
            selectedScoreIndex={selectedScoreIndex}
            partIdToScoreIndex={props.partIdToScoreIndex}
            partDisplayMap={partDisplayMap}
            expandedDoublings={props.expandedDoublings}
            selectedPaths={props.selectedPaths}
            dragState={props.dragState}
            dropTarget={props.dropTarget}
            editingGroupLabel={props.editingGroupLabel}
            scoreDragIndex={scoreDragIndex}
            scoreDropIndex={scoreDropIndex}
            renamingScoreIndex={props.renamingScoreIndex}
            renamingScoreName={props.renamingScoreName}
            canEdit={props.canEdit}
            onSelectScore={props.onSelectScore}
            onLayoutChange={props.onLayoutChange}
            onReorderScores={onReorderScores}
            onDeleteScore={props.onDeleteScore}
            onRenameScore={props.onRenameScore}
            onDuplicateScore={props.onDuplicateScore}
            onResetLayout={props.onResetLayout}
            onAddInstrumentToScore={props.onAddInstrumentToScore}
            onManageInstruments={props.onManageInstruments}
            setScoreDragIndex={setScoreDragIndex}
            setScoreDropIndex={setScoreDropIndex}
            setRenamingScoreIndex={props.setRenamingScoreIndex}
            setRenamingScoreName={props.setRenamingScoreName}
            setCollapsedScores={props.setCollapsedScores}
            setSelectedPaths={props.setSelectedPaths}
            setSelectionAnchor={props.setSelectionAnchor}
            setDropTarget={props.setDropTarget}
            setContextMenu={props.setContextMenu}
            setEditingGroup={props.setEditingGroup}
            setEditingGroupLabel={props.setEditingGroupLabel}
            filterModeRef={props.filterModeRef}
            toggleGroup={props.toggleGroup}
            toggleDoubling={props.toggleDoubling}
            updateGroupProp={props.updateGroupProp}
            openGroupContextMenu={props.openGroupContextMenu}
            openStaffContextMenu={props.openStaffContextMenu}
            handleNodeClick={props.handleNodeClick}
            handleDragStart={props.handleDragStart}
            handleDragOver={props.handleDragOver}
            handleDragEnd={props.handleDragEnd}
            handleDrop={props.handleDrop}
          />
        );
      })}
      {scoreDropIndex != null && scoreDropIndex === visibleScores.length && scoreDragIndex != null && (
        <div
          style={END_DROP_INDICATOR_STYLE}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setScoreDropIndex(visibleScores.length);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (scoreDragIndex != null && onReorderScores) {
              const to = scoreDragIndex < visibleScores.length ? visibleScores.length - 1 : visibleScores.length;
              if (scoreDragIndex !== to) onReorderScores(scoreDragIndex, to);
            }
            setScoreDragIndex(null);
            setScoreDropIndex(null);
          }}
        />
      )}
      {onAddScore && (
        <AddScoreButton
          parts={score.parts}
          partDisplayMap={partDisplayMap}
          onAddScore={onAddScore}
          onAddSectionScore={props.onAddSectionScore}
        />
      )}
    </>
  );
}
