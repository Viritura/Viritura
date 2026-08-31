import { useMemo } from "react";
import { DrumKitStaff } from "./DrumKitStaff";
import { PadGrid } from "./PadGrid";
import { PieceInspector } from "./PieceInspector";
import type { KitViewProps } from "./kitViewTypes";
import styles from "./KitWorkbench.module.css";

/**
 * The drum-kit workbench: a notation-first editor that combines the live
 * engine staff, the pad grid, and the per-piece inspector into one surface.
 *
 * Layout:
 *  - top: the real engraved staff spans the full width (click to add, drag to
 *    move, click to select — runs the WASM engine).
 *  - bottom-left: the MPC-style pad grid (one pad per component).
 *  - bottom-right: the inspector for the selected piece (name, notehead,
 *    staff position, sound).
 */
export function KitWorkbench({
  rows,
  selectedId,
  onSelect,
  onAdd,
  onMove,
  onRemove,
  onUpdate,
  onPreview,
}: KitViewProps) {
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  return (
    <div className={styles.root}>
      <div className={styles.staff}>
        <DrumKitStaff rows={rows} selectedId={selectedId} onAdd={onAdd} onMove={onMove} onSelect={onSelect} />
      </div>

      <div className={styles.columns}>
        <div className={styles.padCol}>
          <PadGrid
            rows={rows}
            selectedId={selectedId}
            onSelect={onSelect}
            onAdd={onAdd}
            onRemove={onRemove}
            onUpdate={onUpdate}
          />
        </div>
        <div className={styles.inspectorCol}>
          <PieceInspector piece={selected} onUpdate={onUpdate} onRemove={onRemove} onPreview={onPreview} />
        </div>
      </div>
    </div>
  );
}
