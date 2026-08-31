import { useState, useCallback, type CSSProperties } from "react";
import type { ScoreDefinition, LayoutDefinition, Part } from "@viritura/core";
import { ContextMenu, type ContextMenuState } from "@viritura/ui";
import { usePartListContextMenus } from "./parts/usePartListContextMenus";
import { ScoreListBody } from "./parts/ScoreListBody";
import { useDocumentStore } from "../store/DocumentContext";
import { InstrumentCatalogPicker } from "./parts/InstrumentCatalogPicker";
import { usePartListDrumKit } from "./parts/usePartListDrumKit";
import { type NodePath } from "./parts/treeOps";
import { usePartListLayout } from "./parts/usePartListLayout";
import { usePartListSelection } from "./parts/usePartListSelection";
import { useScoreMembershipDialog } from "./parts/useScoreMembershipDialog";
import { useDragAutoscroll } from "../hooks/useDragAutoscroll";
import { panelStyle, addPanelStyle } from "./parts/styles";

const SCROLL_AREA_STYLE: CSSProperties = { flex: 1, overflowY: "auto", overflowX: "hidden" };

export interface PartListPanelProps {
  scoreDefinitions: ScoreDefinition[];
  selectedScoreIndex: number;
  onSelectScore: (index: number) => void;
  onLayoutChange?: (layouts: LayoutDefinition[]) => void;
  onSelectedPartsChange?: (partIds: string[]) => void;
  onAddInstrument?: (instrumentId: string, targetLayoutIds?: readonly string[]) => void;
  onRemoveInstrument?: (partId: string) => void;
  /** Add an existing instrument's staff to the score at `scoreIndex` (Layouts mode). */
  onAddInstrumentToScore?: (scoreIndex: number, partId: string) => void;
  /** Remove an instrument's staff from the score at `scoreIndex` (part stays in document). */
  onRemoveInstrumentFromScore?: (scoreIndex: number, partId: string) => void;
  /** Create a new section score containing exactly the chosen parts. */
  onCreateSectionScore?: (partIds: readonly string[], name?: string) => void;
  /** Set the score at `scoreIndex` to contain exactly the chosen parts. */
  onSetScoreMembership?: (scoreIndex: number, partIds: readonly string[]) => void;
  onReorderInstrument?: (fromPartId: string, toPartId: string, placeAfter: boolean) => void;
  onAddDoubling?: (staffPath: NodePath, instrumentId: string) => void;
  onRemoveDoubling?: (staffPath: NodePath, sourceIndex: number) => void;
  onPartUpdate?: (
    partId: string,
    updates: Partial<Pick<Part, "name" | "shortName" | "staves" | "transposition">>,
  ) => void;
  onAddScore?: (type: "full" | "condensed" | "custom" | "part", partId?: string) => void;
  onDeleteScore?: (index: number) => void;
  onRenameScore?: (index: number, name: string) => void;
  onDuplicateScore?: (index: number) => void;
  onResetLayout?: (index: number) => void;
  onExpandCondensingStave?: (pathKey: string) => void;
  onReorderScores?: (fromIndex: number, toIndex: number) => void;
}

// ─── Local types ────────────────────────────────────────────────

// eslint-disable-next-line max-lines-per-function -- coordinator component: wires four sub-hooks (layout, selection, context-menus, membership dialog) to ScoreListBody. Already decomposed (DoublingPicker + hooks extracted); the remaining body is a flat prop-threading conductor where further container/presenter splits would be pure ceremony (an AGENTS.md anti-pattern).
export function PartListPanel({
  scoreDefinitions,
  selectedScoreIndex,
  onSelectScore,

  onLayoutChange,
  onSelectedPartsChange,
  onAddInstrument: _onAddInstrument,
  onRemoveInstrument,
  onAddInstrumentToScore,
  onRemoveInstrumentFromScore,
  onAddDoubling,
  onRemoveDoubling,
  onPartUpdate: _onPartUpdate,
  onAddScore,
  onCreateSectionScore,
  onSetScoreMembership,
  onDeleteScore,
  onRenameScore,
  onDuplicateScore,
  onResetLayout,
  onExpandCondensingStave,
  onReorderScores,
}: PartListPanelProps) {
  const score = useDocumentStore((s) => s.score);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  /** Per-score collapse state. A collapsed score keeps its selection
   *  but hides the nested staves tree below the header row. */
  const [collapsedScores, setCollapsedScores] = useState<Set<number>>(new Set());
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingGroupLabel, setEditingGroupLabel] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [expandedDoublings, setExpandedDoublings] = useState<Set<string>>(new Set());
  const [doublingStaffPath, setDoublingStaffPath] = useState<NodePath | null>(null);

  // Score list state
  const [renamingScoreIndex, setRenamingScoreIndex] = useState<number | null>(null);
  const [renamingScoreName, setRenamingScoreName] = useState("");

  // Score-level drag-and-drop
  const [scoreDragIndex, setScoreDragIndex] = useState<number | null>(null);
  const [scoreDropIndex, setScoreDropIndex] = useState<number | null>(null);

  const toggleDoubling = useCallback(
    (pathKey: string) => {
      setExpandedDoublings((prev) => {
        const next = new Set(prev);
        if (next.has(pathKey)) next.delete(pathKey);
        else next.add(pathKey);
        return next;
      });
      onExpandCondensingStave?.(pathKey);
    },
    [onExpandCondensingStave],
  );

  const {
    layoutContent,
    flatRows,
    partDisplayMap,
    partIdToScoreIndex,
    visibleScores,
    staffCountByScoreIndex,
    activeStaffCount,
    partsSectionStart,
    removeGroup,
    updateGroupProp,
    ungroupStaff,
    createGroupFromSelection: createGroupFromSelectionRaw,
    dragState,
    dropTarget,
    setDropTarget,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  } = usePartListLayout({
    score,
    scoreDefinitions,
    selectedScoreIndex,
    collapsedGroups,
    editingGroup,
    onLayoutChange,
  });

  const toggleGroup = useCallback((pathKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  }, []);

  const {
    selectedPaths,
    setSelectedPaths,
    setSelectionAnchor,
    filterModeRef,
    handleNodeClick,
    buildSelectionMenuItems,
  } = usePartListSelection({
    layoutContent,
    collapsedGroups,
    hasScore: !!score,
    onSelectedPartsChange,
    createGroupFromSelectionRaw,
  });

  // Auto-scroll the list when a dragged row hovers near the top/bottom edge.
  const { ref: scrollRef } = useDragAutoscroll<HTMLDivElement>();

  // Section-score creation + per-score instrument management dialog.
  const { openSectionDialog, openManageDialog, dialogElement } = useScoreMembershipDialog({
    score,
    partDisplayMap,
    onCreateSectionScore,
    onSetScoreMembership,
  });

  const drumKitCmd = usePartListDrumKit(score);
  const { openGroupContextMenu, openStaffContextMenu } = usePartListContextMenus({
    selectedPaths,
    buildSelectionMenuItems,
    setContextMenu,
    removeGroup,
    updateGroupProp,
    setEditingGroup,
    setEditingGroupLabel,
    partIdToScoreIndex,
    onSelectScore,
    ungroupStaff,
    onAddDoubling,
    onRemoveDoubling,
    onRemoveInstrument,
    selectedScoreIndex,
    activeScoreIsConductor: activeStaffCount > 1,
    onRemoveInstrumentFromScore,
    ...drumKitCmd,
    layoutContent,
    partDisplayMap,
    setDoublingStaffPath,
  });

  return (
    <div style={panelStyle}>
      {/* Scrollable scores + nested staves */}
      <div
        ref={scrollRef}
        className="viritura-scroll"
        style={SCROLL_AREA_STYLE}
        onClick={() => {
          setSelectedPaths(new Set());
          setSelectionAnchor(null);
        }}
      >
        {score && (
          <ScoreListBody
            score={score}
            visibleScores={visibleScores}
            selectedScoreIndex={selectedScoreIndex}
            staffCountByScoreIndex={staffCountByScoreIndex}
            activeStaffCount={activeStaffCount}
            partsSectionStart={partsSectionStart}
            collapsedScores={collapsedScores}
            layoutContent={layoutContent}
            flatRows={flatRows}
            partIdToScoreIndex={partIdToScoreIndex}
            partDisplayMap={partDisplayMap}
            expandedDoublings={expandedDoublings}
            selectedPaths={selectedPaths}
            dragState={dragState}
            dropTarget={dropTarget}
            editingGroupLabel={editingGroupLabel}
            scoreDragIndex={scoreDragIndex}
            scoreDropIndex={scoreDropIndex}
            renamingScoreIndex={renamingScoreIndex}
            renamingScoreName={renamingScoreName}
            canEdit={!!onLayoutChange}
            onSelectScore={onSelectScore}
            onLayoutChange={onLayoutChange}
            onReorderScores={onReorderScores}
            onDeleteScore={onDeleteScore}
            onRenameScore={onRenameScore}
            onDuplicateScore={onDuplicateScore}
            onResetLayout={onResetLayout}
            onAddScore={onAddScore}
            onAddSectionScore={openSectionDialog}
            onAddInstrumentToScore={onAddInstrumentToScore}
            onManageInstruments={openManageDialog}
            setScoreDragIndex={setScoreDragIndex}
            setScoreDropIndex={setScoreDropIndex}
            setRenamingScoreIndex={setRenamingScoreIndex}
            setRenamingScoreName={setRenamingScoreName}
            setCollapsedScores={setCollapsedScores}
            setSelectedPaths={setSelectedPaths}
            setSelectionAnchor={setSelectionAnchor}
            setDropTarget={setDropTarget}
            setContextMenu={setContextMenu}
            setEditingGroup={setEditingGroup}
            setEditingGroupLabel={setEditingGroupLabel}
            filterModeRef={filterModeRef}
            toggleGroup={toggleGroup}
            toggleDoubling={toggleDoubling}
            updateGroupProp={updateGroupProp}
            openGroupContextMenu={openGroupContextMenu}
            openStaffContextMenu={openStaffContextMenu}
            handleNodeClick={handleNodeClick}
            handleDragStart={handleDragStart}
            handleDragOver={handleDragOver}
            handleDragEnd={handleDragEnd}
            handleDrop={handleDrop}
          />
        )}
      </div>

      {/* Inline doubling instrument picker */}
      <DoublingPicker
        staffPath={doublingStaffPath}
        onAddDoubling={onAddDoubling}
        onClose={() => setDoublingStaffPath(null)}
      />

      {/* Footer toggles */}
      {/* Context menu */}
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      {dialogElement}
    </div>
  );
}

/** Inline catalog picker shown when adding a doubling to a staff. */
function DoublingPicker({
  staffPath,
  onAddDoubling,
  onClose,
}: {
  staffPath: NodePath | null;
  onAddDoubling: PartListPanelProps["onAddDoubling"];
  onClose: () => void;
}) {
  if (!staffPath || !onAddDoubling) return null;
  return (
    <div style={addPanelStyle}>
      <InstrumentCatalogPicker
        searchPlaceholder="Add doubling…"
        autoFocus
        onClose={onClose}
        onSelect={(inst) => {
          onAddDoubling(staffPath, inst.id);
          onClose();
        }}
      />
    </div>
  );
}
