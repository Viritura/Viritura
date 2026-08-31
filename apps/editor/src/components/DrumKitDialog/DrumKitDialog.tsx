import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogActions,
  DialogCancelButton,
  DialogPrimaryButton,
  Button,
  IconButton,
  Select,
} from "@viritura/ui";
import { Check, Undo2, X } from "lucide-react";
import { PERCUSSION_PRESETS, getPercussionPreset } from "../../score/percussionPresets";
import type { KitComponentEdit, DrumKitTarget } from "./types";
import { defaultKeyForStaffPosition, freshComponentId, presetToEdits, matchPresetId } from "./drumKitOptions";
import type { KitViewProps } from "./kitViewTypes";
import { KitWorkbench } from "./KitWorkbench";
import styles from "./DrumKitDialog.module.css";

export interface DrumKitDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The percussion part to edit, or null when none is selected/available. */
  readonly target: DrumKitTarget | null;
  /** Persist the edited mapping rows back to the score. */
  readonly onApply: (edits: readonly KitComponentEdit[]) => void;
  /** Audition a drum hit: play `midiKey` on the given kit program (undefined =
   *  the part's default kit). */
  readonly onPreview: (midiKey: number, drumKit: number | undefined) => void;
  /** Import-confidence warning shown while reviewing an inferred MusicXML map. */
  readonly reviewNotice?: string | null;
  /** Optional DOM node for embedding the dialog inside a bounded surface. */
  readonly container?: HTMLElement | null;
  /** Render as a permanently open, non-modal workbench without dismissal chrome. */
  readonly embedded?: boolean;
}

const PRESET_OPTIONS = [
  { value: "", label: "Load preset…" },
  ...PERCUSSION_PRESETS.map((p) => ({ value: p.id, label: `${p.name} — ${p.description}` })),
];

const byStaffDescending = (a: KitComponentEdit, b: KitComponentEdit): number => b.staffPosition - a.staffPosition;

export function DrumKitDialog({
  open,
  onClose,
  target,
  onApply,
  onPreview,
  reviewNotice,
  container,
  embedded = false,
}: DrumKitDialogProps) {
  const [rows, setRows] = useState<KitComponentEdit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // After loading a preset we keep the prior rows so the load is reversible
  // (one-click Undo) instead of gating it behind a pre-confirmation.
  const [undoState, setUndoState] = useState<{ label: string; rows: KitComponentEdit[] } | null>(null);

  // Seed local editable rows whenever the dialog opens on a (different) part.
  useEffect(() => {
    if (open && target) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync: external target seeds local editable copy when the dialog opens
      setRows(target.components.map((c) => ({ ...c })));
      setSelectedId(null);
      setUndoState(null);
    }
  }, [open, target]);

  const updateRow = useCallback((id: string, patch: Partial<KitComponentEdit>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const handleAdd = useCallback((staffPosition: number) => {
    let newId = "";
    setRows((prev) => {
      newId = freshComponentId(prev.map((r) => r.id));
      const next: KitComponentEdit = {
        id: newId,
        name: "New",
        staffPosition,
        notehead: "normal",
        drumKit: undefined,
        midiKey: defaultKeyForStaffPosition(staffPosition),
      };
      return [...prev, next];
    });
    setSelectedId(newId);
  }, []);

  const handleMove = useCallback((id: string, staffPosition: number) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, staffPosition } : r)));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const handlePresetPick = useCallback((presetId: string) => {
    if (!presetId) return;
    const preset = getPercussionPreset(presetId);
    if (!preset) return;
    // Apply immediately and snapshot the prior rows so the load is one-click
    // reversible. Snapshot is taken inside the updater to capture live rows.
    setRows((prev) => {
      setUndoState({ label: `Loaded the “${preset.name}” preset.`, rows: prev });
      return presetToEdits(preset);
    });
    setSelectedId(null);
  }, []);

  const undoBulkChange = useCallback(() => {
    setUndoState((snapshot) => {
      if (snapshot) setRows(snapshot.rows);
      setSelectedId(null);
      return null;
    });
  }, []);

  const sortedRows = useMemo(() => [...rows].sort(byStaffDescending), [rows]);

  // Reflect which preset (if any) the current mapping matches, so the picker
  // shows e.g. "Full Drum Kit" instead of the "Load preset…" placeholder when
  // the kit hasn't been customized.
  const activePresetId = useMemo(() => matchPresetId(rows), [rows]);

  // Selecting a notehead on the staff both highlights its row and auditions it.
  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const row = rows.find((r) => r.id === id);
      if (row) onPreview(row.midiKey, row.drumKit);
    },
    [rows, onPreview],
  );

  const handleApply = useCallback(() => {
    onApply(rows);
    onClose();
  }, [rows, onApply, onClose]);

  const viewProps: KitViewProps = {
    rows: sortedRows,
    selectedId,
    onSelect: handleSelect,
    onAdd: handleAdd,
    onMove: handleMove,
    onRemove: handleRemove,
    onUpdate: updateRow,
    onPreview,
  };

  return (
    <Dialog open={open} onClose={onClose} size="xwide" container={container} modal={!embedded}>
      <DialogHeader
        title={`Percussion Map${target ? ` — ${target.partName}` : ""}`}
        onClose={embedded ? undefined : onClose}
      />

      <DialogBody className={styles.body}>
        <div className={styles.root}>
          <p className={styles.hint}>
            Map each notated position and notehead to a sound. Sounds come from the loaded SoundFont (Shan SGM Pro 15)
            following the General MIDI percussion map; a non-default kit borrows that hit from another GS drum kit.
          </p>
          {reviewNotice && (
            <div className={styles.undoNotice} role="status">
              <p className={styles.undoText}>{reviewNotice}</p>
            </div>
          )}

          {!target ? (
            <p className={styles.empty}>Select an unpitched percussion part to edit its percussion map.</p>
          ) : (
            <>
              <div className={styles.presetBar}>
                <span className={styles.presetLabel}>Presets</span>
                <Select
                  className={styles.presetSelect}
                  value={activePresetId}
                  onValueChange={handlePresetPick}
                  options={PRESET_OPTIONS}
                />
              </div>

              {undoState ? (
                <div className={styles.undoNotice} role="status">
                  <Check size={16} className={styles.undoIcon} aria-hidden />
                  <p className={styles.undoText}>{undoState.label}</p>
                  <Button variant="ghost" size="sm" onClick={undoBulkChange}>
                    <Undo2 size={14} />
                    Undo
                  </Button>
                  <IconButton size="sm" tooltip="Dismiss" onClick={() => setUndoState(null)}>
                    <X size={14} />
                  </IconButton>
                </div>
              ) : null}

              <KitWorkbench {...viewProps} />
              {rows.length === 0 && (
                <p className={styles.empty} role="alert">
                  Add at least one sound before applying this percussion map.
                </p>
              )}
            </>
          )}
        </div>
      </DialogBody>

      {!embedded && (
        <DialogActions>
          <DialogCancelButton />
          <DialogPrimaryButton onClick={handleApply} disabled={!target || rows.length === 0}>
            Apply
          </DialogPrimaryButton>
        </DialogActions>
      )}
    </Dialog>
  );
}
