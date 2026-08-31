import { useCallback } from "react";
import { FormInput, IconButton } from "@viritura/ui";
import { Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { KitComponentEdit } from "./types";
import { NoteheadPalette } from "./NoteheadPalette";
import { SoundCombobox } from "./SoundCombobox";
import styles from "./PieceInspector.module.css";

export interface PieceInspectorProps {
  readonly piece: KitComponentEdit | null;
  readonly onUpdate: (id: string, patch: Partial<KitComponentEdit>) => void;
  readonly onRemove: (id: string) => void;
  readonly onPreview: (midiKey: number, drumKit: number | undefined) => void;
}

/**
 * Editor for a single selected drum piece — name, staff position, notehead
 * palette, and sound (via the searchable Sound combobox). Shared by the Drumset
 * Editor and Pad Kit views; both select a piece elsewhere and edit it here.
 */
export function PieceInspector({ piece, onUpdate, onRemove, onPreview }: PieceInspectorProps) {
  const adjustPosition = useCallback(
    (delta: number) => {
      if (piece) onUpdate(piece.id, { staffPosition: piece.staffPosition + delta });
    },
    [piece, onUpdate],
  );

  const setPosition = useCallback(
    (raw: string) => {
      if (!piece) return;
      const next = Number.parseInt(raw, 10);
      if (Number.isFinite(next)) onUpdate(piece.id, { staffPosition: next });
    },
    [piece, onUpdate],
  );

  if (!piece) {
    return <div className={styles.empty}>Select a drum to edit its notehead and sound.</div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.headerRow}>
        <FormInput
          className={styles.name}
          value={piece.name}
          aria-label="Drum name"
          onChange={(e) => onUpdate(piece.id, { name: e.target.value })}
        />
        <div className={styles.headerActions}>
          <IconButton size="sm" tooltip="Remove this drum" onClick={() => onRemove(piece.id)}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Sound</span>
        <SoundCombobox
          drumKit={piece.drumKit}
          midiKey={piece.midiKey}
          onPick={(midiKey, drumKit) => onUpdate(piece.id, { midiKey, drumKit })}
          onPreview={onPreview}
        />
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <span className={styles.label}>Notehead</span>
          <NoteheadPalette value={piece.notehead} onChange={(notehead) => onUpdate(piece.id, { notehead })} />
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Staff position</span>
          <div className={styles.stepper}>
            <FormInput
              type="number"
              className={styles.posInput}
              value={piece.staffPosition}
              aria-label="Staff position"
              onChange={(e) => setPosition(e.target.value)}
            />
            <div className={styles.stepperButtons}>
              {/* eslint-disable-next-line no-restricted-syntax -- bespoke spinner up button (compact chevron), paired with the number field */}
              <button type="button" className={styles.stepBtn} onClick={() => adjustPosition(1)} aria-label="Move up">
                <ChevronUp size={14} />
              </button>
              {/* eslint-disable-next-line no-restricted-syntax -- bespoke spinner down button (compact chevron), paired with the number field */}
              <button
                type="button"
                className={styles.stepBtn}
                onClick={() => adjustPosition(-1)}
                aria-label="Move down"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
