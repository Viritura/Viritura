/**
 * CondensedStaffToggles — in-canvas expand/collapse handles for condensed
 * staves.
 *
 * Condensing is a headline engraving feature, and the thing a user wants to do
 * with a condensed stave — see the two players apart for a moment — is a
 * *pointing* gesture at a staff they can already see. A menu listing
 * "Horn 1 / Horn 2" was an abstraction over something on screen. So the handle
 * sits on the staff itself, floating at the left edge like the sticky
 * clef/instrument-name column, and follows scroll and zoom.
 *
 * Rendered as DOM rather than painted into the canvas: the handle count is
 * small (one per condensed staff), and DOM buys hover, focus, keyboard
 * activation, and tooltips without adding a hit-test pass to the paint loop.
 */
import { useMemo, type CSSProperties } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Tooltip } from "@viritura/ui";
import type { DisplayList } from "@viritura/renderer";
import type { WriteViewMode as ViewMode } from "@viritura/ui";
import type { Score } from "@viritura/core";
import { collectCondensedStaffRows } from "./condensedStaffRows";
import { condensedHandleX, condensedHandleY } from "./condensedHandlePlacement";
import styles from "./CondensedStaffToggles.module.css";

const ROOT_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 6,
};

export interface CondensedStaffTogglesProps {
  readonly score: Score | null;
  readonly displayList: DisplayList | null;
  readonly selectedScoreIndex: number;
  readonly expanded: Set<string>;
  readonly onToggle: (pathKey: string) => void;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
  /** Only horizon view paints a sticky clef column. */
  readonly viewMode: ViewMode;
  /** Left inset of the floating panel, so handles stay clear of it. */
  readonly safeAreaLeft?: number;
}

interface StaffExtent {
  systemIndex: number;
  staffIndex: number;
  left: number;
  top: number;
  bottom: number;
  height: number;
}

interface PositionedHandle {
  /** Unique per (system, staff) — a condensed staff recurs on every system. */
  readonly key: string;
  readonly pathKey: string;
  readonly label: string;
  readonly expanded: boolean;
  readonly top: number;
  readonly left: number;
  readonly partCount: number;
}

/** Absolute placement for a handle. Dynamic (scroll/zoom), so it can't be CSS. */
function handlePosition(top: number, left: number): CSSProperties {
  return { top, left };
}

export function CondensedStaffToggles({
  score,
  displayList,
  selectedScoreIndex,
  expanded,
  onToggle,
  scrollX,
  scrollY,
  zoom,
  viewMode,
  safeAreaLeft = 0,
}: CondensedStaffTogglesProps) {
  const handles = useMemo<PositionedHandle[]>(() => {
    const rows = collectCondensedStaffRows(score, selectedScoreIndex, expanded);
    if (rows.length === 0 || !displayList?.measureBounds?.length) return [];

    // Extents keyed per (system, staff). Keying on staffIndex alone would fuse
    // the same staff across every system of a paged layout into one giant
    // extent spanning the page — correct only in horizon view, where there is
    // a single system. One pass keeps this linear in bounds.
    const extents = new Map<string, StaffExtent>();
    for (const b of displayList.measureBounds) {
      if (b.isHidden) continue;
      const systemIndex = b.systemIndex ?? 0;
      const key = `${systemIndex}|${b.staffIndex}`;
      const existing = extents.get(key);
      if (existing) {
        existing.left = Math.min(existing.left, b.x);
        existing.top = Math.min(existing.top, b.y);
        existing.bottom = Math.max(existing.bottom, b.y + b.height);
        existing.height = Math.max(existing.height, b.height);
      } else {
        extents.set(key, {
          systemIndex,
          staffIndex: b.staffIndex,
          left: b.x,
          top: b.y,
          bottom: b.y + b.height,
          height: b.height,
        });
      }
    }

    // Staves of each system, top to bottom, so "the staff below this one" is
    // just the next entry — no assumption that staffIndex is dense.
    const bySystem = new Map<number, StaffExtent[]>();
    for (const e of extents.values()) {
      const list = bySystem.get(e.systemIndex);
      if (list) list.push(e);
      else bySystem.set(e.systemIndex, [e]);
    }
    for (const list of bySystem.values()) list.sort((a, b) => a.top - b.top);

    const out: PositionedHandle[] = [];
    for (const row of rows) {
      // A condensed staff appears once per system, so it gets one handle per
      // system — matching how engrave-mode ghost rails are derived.
      for (const [systemIndex, list] of bySystem) {
        const at = list.findIndex((e) => e.staffIndex === row.staffIndex);
        if (at < 0) continue;
        const extent = list[at]!;
        const spatium = extent.height / 4;

        const left = condensedHandleX({
          staffLeftScore: extent.left,
          spatium,
          scrollX,
          zoom,
          horizon: viewMode === "horizon",
          safeAreaLeft,
        });
        const top = condensedHandleY({
          staffBottomScore: extent.bottom,
          nextStaffTopScore: list[at + 1]?.top ?? null,
          scrollY,
          zoom,
        });
        // Viewport geometry can be momentarily undefined between a relayout
        // and the first paint; skip rather than emit NaN into the style.
        if (!Number.isFinite(top) || !Number.isFinite(left)) continue;

        out.push({
          key: `${systemIndex}|${row.pathKey}`,
          pathKey: row.pathKey,
          label: row.label,
          expanded: row.expanded,
          top,
          left,
          partCount: row.partLabels.length,
        });
      }
    }
    return out;
  }, [score, selectedScoreIndex, expanded, displayList, scrollX, scrollY, zoom, viewMode, safeAreaLeft]);

  if (handles.length === 0) return null;

  return (
    <div style={ROOT_STYLE}>
      {handles.map((h) => (
        <Tooltip
          key={h.key}
          side="right"
          content={
            h.expanded ? `Collapse back to one staff — ${h.label}` : `Expand to ${h.partCount} staves — ${h.label}`
          }
        >
          {/* eslint-disable-next-line no-restricted-syntax -- positional canvas trigger: absolutely placed over the engraving and sized to the staff, so it can't use a @viritura/ui button shape. */}
          <button
            type="button"
            className={styles.handle}
            data-expanded={h.expanded ? "true" : "false"}
            style={handlePosition(h.top, h.left)}
            aria-label={h.expanded ? `Collapse ${h.label}` : `Expand ${h.label}`}
            aria-expanded={h.expanded}
            onClick={() => onToggle(h.pathKey)}
          >
            {h.expanded ? (
              <ChevronsDownUp size={13} aria-hidden="true" />
            ) : (
              <ChevronsUpDown size={13} aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
