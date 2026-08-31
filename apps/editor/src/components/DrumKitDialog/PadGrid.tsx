import type { CSSProperties } from "react";
import { useState } from "react";
import { Plus } from "lucide-react";
import { ContextMenu, type ContextMenuState, type MenuItemDef } from "@viritura/ui";
import { KitNoteGlyph } from "./KitNoteGlyph";
import { NOTEHEAD_OPTIONS, asNoteheadShape } from "./drumKitOptions";
import { drumFamily, FAMILY_COLOR_VAR } from "./kitViewTypes";
import type { KitComponentEdit } from "./types";
import styles from "./PadGrid.module.css";

/** Staff position a new pad is added at (a middle-ish default the user can
 *  refine in the inspector). */
const NEW_PAD_POSITION = 2;

export interface PadGridProps {
  readonly rows: readonly KitComponentEdit[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onAdd: (staffPosition: number) => void;
  readonly onRemove: (id: string) => void;
  readonly onUpdate: (id: string, patch: Partial<KitComponentEdit>) => void;
}

/**
 * MPC / Drum-Rack style grid of pads. Each pad renders a real mini-staff with
 * the notehead at its position (see `KitNoteGlyph`), the name, and a
 * staff-position badge, tinted by drum family. Clicking a pad selects +
 * auditions it. Selecting a pad is edited in the adjacent inspector.
 * Right-clicking a pad opens a context menu: pick a notehead shape, or delete.
 */
export function PadGrid({ rows, selectedId, onSelect, onAdd, onRemove, onUpdate }: PadGridProps) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const openMenu = (e: React.MouseEvent, row: KitComponentEdit) => {
    e.preventDefault();
    const noteheadItems: MenuItemDef[] = NOTEHEAD_OPTIONS.map((opt) => ({
      // A leading check marks the current shape; the glyph hint stays aligned.
      label: `${opt.value === row.notehead ? "✓ " : "\u2007 "}${opt.label}`,
      action: () => onUpdate(row.id, { notehead: asNoteheadShape(opt.value) }),
    }));
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [...noteheadItems, { separator: true }, { label: "Delete", action: () => onRemove(row.id) }],
    });
  };

  return (
    <div className={styles.grid} role="group" aria-label="Drum pads">
      {rows.map((row) => (
        <Pad key={row.id} row={row} active={row.id === selectedId} onSelect={onSelect} onContextMenu={openMenu} />
      ))}
      {/* eslint-disable-next-line no-restricted-syntax -- bespoke add-pad tile (dashed square in the pad grid) */}
      <button type="button" className={styles.addPad} onClick={() => onAdd(NEW_PAD_POSITION)} aria-label="Add drum">
        <Plus size={20} />
      </button>
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

interface PadProps {
  readonly row: KitComponentEdit;
  readonly active: boolean;
  readonly onSelect: (id: string) => void;
  readonly onContextMenu: (e: React.MouseEvent, row: KitComponentEdit) => void;
}

function Pad({ row, active, onSelect, onContextMenu }: PadProps) {
  const color = FAMILY_COLOR_VAR[drumFamily(row)];
  // Family color drives the accent stripe + active ring; named variable keeps
  // it out of a forbidden inline-literal style.
  const padStyle = { "--pad-accent": color } as CSSProperties;
  return (
    // eslint-disable-next-line no-restricted-syntax -- bespoke drum pad (MPC/Drum-Rack style square), not a text button
    <button
      type="button"
      className={active ? styles.padActive : styles.pad}
      style={padStyle}
      onClick={() => onSelect(row.id)}
      onContextMenu={(e) => onContextMenu(e, row)}
      aria-pressed={active}
      aria-label={`${row.name}, staff position ${row.staffPosition}`}
    >
      <span className={styles.padStripe} aria-hidden />
      <span className={styles.padStaff}>
        <KitNoteGlyph staffPosition={row.staffPosition} notehead={row.notehead} />
      </span>
      <span className={styles.padName}>{row.name}</span>
      <span className={styles.padPos}>{row.staffPosition}</span>
    </button>
  );
}
