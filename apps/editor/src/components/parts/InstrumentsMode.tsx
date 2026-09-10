import { useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Button, PanelFooter, SectionLabel } from "@viritura/ui";
import { InstrumentsEmptyState } from "./InstrumentsEmptyState";
import { resolvePartDisplayNames, type Part, type PartDisplayInfo } from "@viritura/core";
import { useDocumentStore } from "../../store/DocumentContext";
import { type CatalogInstrument } from "../../score/InstrumentCatalog";
import { collectConductorScores, type ConductorScore } from "../../score/ScoreMutations";
import { isPercussionPart } from "../../score/kitInput";
import { resolveDrumKitTarget } from "../../commands/drumKitCommands";
import type { PartListPanelProps } from "../PartListPanel";
import { usePartListDrumKit } from "./usePartListDrumKit";
import { useDragAutoscroll } from "../../hooks/useDragAutoscroll";
import { RosterPartRow } from "./roster/RosterPartRow";
import { dropIndicatorStyle } from "./styles";
import { ConfirmationDialog } from "../ConfirmationDialog";
import { useChangeInstrument } from "./useChangeInstrument";
import { InstrumentPickerDialog } from "./InstrumentPickerDialog";

const INSTRUMENTS_NO_SCORE_STYLE: CSSProperties = {
  padding: 16,
  fontSize: "var(--type-small-size)",
  color: "var(--text-muted)",
};
const INSTRUMENTS_ROOT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
};
const INSTRUMENTS_LIST_STYLE: CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto" };

function rowWrapStyle(isDragging: boolean): CSSProperties {
  return { position: "relative", opacity: isDragging ? 0.4 : 1 };
}

interface DropTarget {
  partId: string;
  after: boolean;
}

/**
 * Instruments mode — manages the score's ensemble (the set of parts)
 * without regard to layout-tree placement.
 *
 *   • Top section: collapsible list of parts; click a row to expand
 *     inline name/short-name/transposition editor + remove button.
 *   • Bottom section: always-visible InstrumentCatalogPicker.
 *
 * When the score has no parts yet and the host supplies `onAddEnsemble`
 * (Setup mode), the empty state offers the ensemble templates that used to
 * be step 1 of the New Score wizard.
 */
export interface InstrumentsModeProps extends PartListPanelProps {
  /** Add every instrument of an ensemble template in one edit. */
  readonly onAddEnsemble?: (templateId: string) => void;
}

export function InstrumentsMode({
  onAddInstrument,
  onAddEnsemble,
  onRemoveInstrument,
  onReorderInstrument,
  onPartUpdate,
}: InstrumentsModeProps) {
  const score = useDocumentStore((s) => s.score);
  const updateScore = useDocumentStore((s) => s.updateScore);
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  /** Instrument chosen in the picker, awaiting score-inclusion selection. */
  const [pendingInst, setPendingInst] = useState<CatalogInstrument | null>(null);
  /** Layout ids of the multi-instrument scores that should include it. */
  const [targetLayoutIds, setTargetLayoutIds] = useState<Set<string>>(new Set());
  const [dragPartId, setDragPartId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const { onEditDrumKit } = usePartListDrumKit(score);
  const changeInstrument = useChangeInstrument({ score, updateScore, onAddInstrument });

  const conductorScores = useMemo<ConductorScore[]>(() => (score ? collectConductorScores(score) : []), [score]);

  // Auto-scroll the roster when a dragged part hovers near the top/bottom edge.
  const { ref: listRef } = useDragAutoscroll<HTMLDivElement>();

  // Resolve the drum-kit mapping rows for the expanded percussion part only,
  // so the row can show a read-only mapping preview in place of transposition.
  const expandedKitRows = useMemo(() => {
    if (!score || !expandedPartId) return null;
    const idx = score.parts.findIndex((p) => p.id === expandedPartId);
    if (idx < 0 || !isPercussionPart(score.parts[idx])) return null;
    return resolveDrumKitTarget(score, idx)?.components ?? null;
  }, [score, expandedPartId]);

  const partDisplayMap = useMemo(() => {
    const map = new Map<string, PartDisplayInfo>();
    if (!score) return map;
    const infos = resolvePartDisplayNames(score.parts);
    for (let i = 0; i < score.parts.length; i++) {
      const partId = score.parts[i]!.id;
      if (partId) map.set(partId, infos[i]!);
    }
    return map;
  }, [score]);

  const handleAdd = useCallback(
    (inst: CatalogInstrument) => {
      setPendingInst(inst);
      setTargetLayoutIds(new Set(conductorScores.map((c) => c.layoutId)));
    },
    [conductorScores],
  );

  const handleToggleTarget = useCallback((layoutId: string) => {
    setTargetLayoutIds((prev) => {
      const next = new Set(prev);
      if (next.has(layoutId)) next.delete(layoutId);
      else next.add(layoutId);
      return next;
    });
  }, []);

  const handleConfirmAdd = useCallback(() => {
    if (!pendingInst) return;
    onAddInstrument?.(pendingInst.id, Array.from(targetLayoutIds));
    setShowPicker(false);
    setPendingInst(null);
    setTargetLayoutIds(new Set());
  }, [pendingInst, targetLayoutIds, onAddInstrument]);

  const handleCancelAdd = useCallback(() => {
    setPendingInst(null);
    setTargetLayoutIds(new Set());
  }, []);
  const closeAddDialog = useCallback(() => {
    setShowPicker(false);
    handleCancelAdd();
  }, [handleCancelAdd]);

  const handleToggle = useCallback((partId: string) => {
    setExpandedPartId((prev) => (prev === partId ? null : partId));
  }, []);

  const handleDrop = useCallback(
    (parts: readonly Part[]) => {
      if (!dragPartId || !dropTarget || !onReorderInstrument) return;
      if (dragPartId === dropTarget.partId) return;
      // Skip moves that resolve to the part's current slot (no-op).
      const fromIdx = parts.findIndex((p) => p.id === dragPartId);
      const toIdx = parts.findIndex((p) => p.id === dropTarget.partId);
      if (fromIdx < 0 || toIdx < 0) return;
      const insertIdx = dropTarget.after ? toIdx + 1 : toIdx;
      const finalIdx = fromIdx < insertIdx ? insertIdx - 1 : insertIdx;
      if (finalIdx !== fromIdx) {
        onReorderInstrument(dragPartId, dropTarget.partId, dropTarget.after);
      }
      setDragPartId(null);
      setDropTarget(null);
    },
    [dragPartId, dropTarget, onReorderInstrument],
  );

  if (!score) {
    return <div style={INSTRUMENTS_NO_SCORE_STYLE}>No score loaded.</div>;
  }

  const canRemove = score.parts.length > 1;
  const reorderable = !!onReorderInstrument && score.parts.length > 1;

  return (
    <div style={INSTRUMENTS_ROOT_STYLE}>
      {/* Parts list */}
      <div className="viritura-scroll" style={INSTRUMENTS_LIST_STYLE} ref={listRef}>
        {score.parts.length > 0 && <SectionLabel label="Instruments" />}
        {score.parts.length === 0 ? (
          <InstrumentsEmptyState onAddEnsemble={onAddEnsemble} />
        ) : (
          score.parts.map((part) => {
            const isExpanded = !!part.id && expandedPartId === part.id;
            const draggable = reorderable && !!part.id && !isExpanded;
            const showBefore =
              !!part.id && dropTarget?.partId === part.id && !dropTarget.after && dragPartId !== part.id;
            const showAfter = !!part.id && dropTarget?.partId === part.id && dropTarget.after && dragPartId !== part.id;
            return (
              <div
                key={part.id ?? part.name}
                style={rowWrapStyle(dragPartId === part.id)}
                draggable={draggable}
                onDragStart={
                  draggable
                    ? (e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", part.id ?? "");
                        setDragPartId(part.id ?? null);
                      }
                    : undefined
                }
                onDragOver={
                  reorderable && !!part.id
                    ? (e) => {
                        if (!dragPartId || dragPartId === part.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDropTarget({ partId: part.id!, after: e.clientY - rect.top > rect.height / 2 });
                      }
                    : undefined
                }
                onDrop={
                  reorderable
                    ? (e) => {
                        e.preventDefault();
                        handleDrop(score.parts);
                      }
                    : undefined
                }
                onDragEnd={() => {
                  setDragPartId(null);
                  setDropTarget(null);
                }}
              >
                {showBefore && <div style={dropIndicatorStyle} />}
                <RosterPartRow
                  part={part}
                  info={part.id ? partDisplayMap.get(part.id) : undefined}
                  expanded={isExpanded}
                  canRemove={canRemove}
                  onToggle={() => part.id && handleToggle(part.id)}
                  onUpdate={onPartUpdate}
                  onRemove={onRemoveInstrument}
                  onEditDrumKit={onEditDrumKit}
                  onChangeInstrument={changeInstrument.setPartId}
                  kitRows={part.id && part.id === expandedPartId ? expandedKitRows : null}
                />
                {showAfter && <div style={dropIndicatorStyle} />}
              </div>
            );
          })
        )}
      </div>

      {onAddInstrument && (
        <AddInstrumentWorkflow
          open={showPicker}
          setOpen={setShowPicker}
          onClose={closeAddDialog}
          onSelect={handleAdd}
          pendingInstrumentId={pendingInst?.id ?? null}
          pendingInstrumentName={pendingInst?.name ?? null}
          conductorScores={conductorScores}
          targetLayoutIds={targetLayoutIds}
          onToggleTarget={handleToggleTarget}
          onConfirm={handleConfirmAdd}
        />
      )}
      <ChangeInstrumentWorkflow workflow={changeInstrument} />
      <ConfirmationDialog
        open={changeInstrument.pending !== null}
        title={changeInstrument.pending?.analysis.allowed ? "Review instrument change" : "Add as a new instrument?"}
        message={
          changeInstrument.pending?.analysis.warning ??
          changeInstrument.pending?.analysis.reason ??
          "This instrument cannot safely replace the existing part."
        }
        confirmLabel={changeInstrument.pending?.analysis.allowed ? "Change Instrument" : "Add Instead"}
        onConfirm={changeInstrument.confirm}
        onCancel={changeInstrument.cancelConfirmation}
      />
    </div>
  );
}

function ChangeInstrumentWorkflow({ workflow }: { workflow: ReturnType<typeof useChangeInstrument> }) {
  return (
    <InstrumentPickerDialog
      mode="change"
      open={workflow.partId !== null}
      onClose={() => workflow.setPartId(null)}
      onSelect={workflow.select}
      onBlockedSelect={workflow.select}
      compatibility={workflow.compatibility}
    />
  );
}

function AddInstrumentWorkflow({
  open,
  setOpen,
  onClose,
  onSelect,
  pendingInstrumentName,
  pendingInstrumentId,
  conductorScores,
  targetLayoutIds,
  onToggleTarget,
  onConfirm,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  onClose: () => void;
  onSelect: (instrument: CatalogInstrument) => void;
  pendingInstrumentName: string | null;
  pendingInstrumentId: string | null;
  conductorScores: readonly ConductorScore[];
  targetLayoutIds: ReadonlySet<string>;
  onToggleTarget: (layoutId: string) => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <PanelFooter>
        <Button fullWidth size="sm" onClick={() => setOpen(true)}>
          Add instrument…
        </Button>
      </PanelFooter>
      <InstrumentPickerDialog
        mode="add"
        open={open}
        onClose={onClose}
        onSelect={onSelect}
        pendingInstrumentId={pendingInstrumentId}
        pendingInstrumentName={pendingInstrumentName}
        conductorScores={conductorScores}
        targetLayoutIds={targetLayoutIds}
        onToggleTarget={onToggleTarget}
        onConfirm={onConfirm}
      />
    </>
  );
}
