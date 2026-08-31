import { useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Plus, X } from "lucide-react";
import { Button, IconButton, Checkbox } from "@viritura/ui";
import { InstrumentsEmptyState } from "./InstrumentsEmptyState";
import { resolvePartDisplayNames, type Part, type PartDisplayInfo } from "@viritura/core";
import { useDocumentStore } from "../../store/DocumentContext";
import { type CatalogInstrument } from "../../score/InstrumentCatalog";
import { collectConductorScores, type ConductorScore } from "../../score/ScoreMutations";
import { isPercussionPart } from "../../score/kitInput";
import { resolveDrumKitTarget } from "../../commands/drumKitCommands";
import type { PartListPanelProps } from "../PartListPanel";
import { InstrumentCatalogPicker } from "./InstrumentCatalogPicker";
import type { InstrumentCompatibility } from "./InstrumentCatalogPicker";
import { usePartListDrumKit } from "./usePartListDrumKit";
import { useDragAutoscroll } from "../../hooks/useDragAutoscroll";
import { RosterPartRow } from "./roster/RosterPartRow";
import { dropIndicatorStyle } from "./styles";
import { ConfirmationDialog } from "../ConfirmationDialog";
import { useChangeInstrument } from "./useChangeInstrument";

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

const ADD_SECTION_STYLE: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  borderTop: "1px solid var(--border, rgba(20, 20, 28, 0.06))",
  background: "rgba(20, 20, 28, 0.015)",
};
const ADD_PICKER_WRAP_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  maxHeight: 320,
};
const ADD_PICKER_HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 8px 2px 10px",
};
const ADD_PICKER_LABEL_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
const ADD_BUTTON_WRAP_STYLE: CSSProperties = { padding: "8px 10px" };
const ADD_TARGET_WRAP_STYLE: CSSProperties = { display: "flex", flexDirection: "column", padding: "8px 10px", gap: 6 };
const ADD_TARGET_TITLE_STYLE: CSSProperties = {
  fontSize: "var(--type-small-size)",
  color: "var(--text)",
};
const ADD_TARGET_TITLE_NAME_STYLE: CSSProperties = { fontWeight: "var(--type-heading-weight)" };
const ADD_TARGET_LIST_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxHeight: 160,
  overflowY: "auto",
  padding: "2px 0",
};
const ADD_TARGET_HINT_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  fontStyle: "italic",
};
const ADD_TARGET_ACTIONS_STYLE: CSSProperties = { display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 2 };
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
      // When the document has multiple multi-instrument scores, let the user
      // choose which layouts include the new instrument. Its source part and
      // instrumental-part view are created regardless of this selection.
      if (conductorScores.length === 0) {
        onAddInstrument?.(inst.id);
        setShowPicker(false);
        return;
      }
      setPendingInst(inst);
      setTargetLayoutIds(new Set(conductorScores.map((c) => c.layoutId)));
      setShowPicker(false);
    },
    [onAddInstrument, conductorScores],
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
    setPendingInst(null);
    setTargetLayoutIds(new Set());
  }, [pendingInst, targetLayoutIds, onAddInstrument]);

  const handleCancelAdd = useCallback(() => {
    setPendingInst(null);
    setTargetLayoutIds(new Set());
  }, []);

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

      {changeInstrument.partId ? (
        <ChangeInstrumentSection
          onSelect={changeInstrument.select}
          onBlockedSelect={(instrument) => changeInstrument.select(instrument)}
          compatibility={changeInstrument.compatibility}
          onCancel={() => changeInstrument.setPartId(null)}
        />
      ) : (
        onAddInstrument &&
        (pendingInst ? (
          <AddTargetSection
            instName={pendingInst.name}
            conductorScores={conductorScores}
            targetLayoutIds={targetLayoutIds}
            onToggleTarget={handleToggleTarget}
            onConfirm={handleConfirmAdd}
            onCancel={handleCancelAdd}
          />
        ) : (
          <AddInstrumentSection showPicker={showPicker} setShowPicker={setShowPicker} handleAdd={handleAdd} />
        ))
      )}
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

function ChangeInstrumentSection({
  onSelect,
  onBlockedSelect,
  compatibility,
  onCancel,
}: {
  onSelect: (instrument: CatalogInstrument) => void;
  onBlockedSelect: (instrument: CatalogInstrument, analysis: InstrumentCompatibility) => void;
  compatibility: (instrument: CatalogInstrument) => InstrumentCompatibility;
  onCancel: () => void;
}) {
  return (
    <div style={ADD_SECTION_STYLE}>
      <div style={ADD_PICKER_WRAP_STYLE}>
        <div style={ADD_PICKER_HEADER_STYLE}>
          <span style={ADD_PICKER_LABEL_STYLE}>Change instrument</span>
          <IconButton size="sm" onClick={onCancel} tooltip="Cancel instrument change">
            <X size={13} />
          </IconButton>
        </div>
        <InstrumentCatalogPicker
          onSelect={onSelect}
          onBlockedSelect={onBlockedSelect}
          compatibility={compatibility}
          autoFocus
          maxHeight={260}
        />
      </div>
    </div>
  );
}

function AddInstrumentSection({
  showPicker,
  setShowPicker,
  handleAdd,
}: {
  showPicker: boolean;
  setShowPicker: (v: boolean) => void;
  handleAdd: (inst: CatalogInstrument) => void;
}) {
  return (
    <div style={ADD_SECTION_STYLE}>
      {showPicker ? (
        <div style={ADD_PICKER_WRAP_STYLE}>
          <div style={ADD_PICKER_HEADER_STYLE}>
            <span style={ADD_PICKER_LABEL_STYLE}>Add instrument</span>
            <IconButton size="sm" onClick={() => setShowPicker(false)} tooltip="Close add instrument">
              <X size={13} />
            </IconButton>
          </div>
          <InstrumentCatalogPicker
            onSelect={(inst) => {
              handleAdd(inst);
            }}
            searchPlaceholder="Search instruments…"
            autoFocus
          />
        </div>
      ) : (
        <div style={ADD_BUTTON_WRAP_STYLE}>
          <Button fullWidth size="sm" onClick={() => setShowPicker(true)}>
            <Plus size={13} />
            Add instrument
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Score-inclusion step shown after an instrument is chosen: a checklist of the
 * document's multi-instrument scores, all pre-checked. The checked layouts gain
 * the instrument; its source part and instrumental-part view are always
 * created regardless of this selection.
 */
function AddTargetSection({
  instName,
  conductorScores,
  targetLayoutIds,
  onToggleTarget,
  onConfirm,
  onCancel,
}: {
  instName: string;
  conductorScores: ConductorScore[];
  targetLayoutIds: Set<string>;
  onToggleTarget: (layoutId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={ADD_SECTION_STYLE}>
      <div style={ADD_TARGET_WRAP_STYLE}>
        <div style={ADD_TARGET_TITLE_STYLE}>
          Include <span style={ADD_TARGET_TITLE_NAME_STYLE}>{instName}</span> in these scores:
        </div>
        <div style={ADD_TARGET_LIST_STYLE}>
          {conductorScores.map((cs) => (
            <Checkbox
              key={cs.layoutId}
              label={cs.name}
              checked={targetLayoutIds.has(cs.layoutId)}
              onChange={() => onToggleTarget(cs.layoutId)}
            />
          ))}
        </div>
        <div style={ADD_TARGET_HINT_STYLE}>The instrument and its instrumental part are always created.</div>
        <div style={ADD_TARGET_ACTIONS_STYLE}>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm}>
            <Plus size={13} />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
