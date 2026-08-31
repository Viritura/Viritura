/**
 * GhostRailOverlay — DOM layer that renders a single Radix Popover for the
 * multi-staff ghost rail the user clicked. Single-staff rails are toggled
 * directly via the canvas click handler and never reach this overlay.
 *
 * The rail itself (red horizontal line + ring) is painted on the main score
 * canvas, and the *click hit-test* now lives on the canvas too
 * (`findGhostRailHitFull`). When a multi-staff ring is clicked, ScoreCanvas
 * lifts the hit rail into state and passes it here as `openRail`. This overlay
 * therefore renders zero per-rail DOM — only one anchor div and one popover —
 * eliminating the O(rails) React reconciliation cost the old per-rail
 * `<button>` pattern incurred on every layout, scroll, and zoom.
 *
 * UX: `openRail` is frozen at click time (ScoreCanvas does not re-derive it
 * while the popover is open), so the rendered checkbox rows stay put even after
 * the user shows a staff and the underlying rail disappears — letting them
 * re-hide it. Closing the popover (outside click or Escape) clears the lifted
 * state via `onClose`.
 */

import * as Popover from "@radix-ui/react-popover";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import { ListRow } from "@viritura/ui";
import { useCallback, useState, type CSSProperties } from "react";

const OVERLAY_ROOT_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 5,
};
const POPOVER_CONTENT_STYLE: CSSProperties = {
  background: "var(--surface-raised, #fff)",
  borderRadius: 8,
  boxShadow: "var(--elevation-1, 0 6px 20px rgba(0,0,0,0.18))",
  padding: 8,
  minWidth: 180,
  zIndex: 1000,
};
const POPOVER_HEADER_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  color: "var(--text-secondary, #555)",
  marginBottom: 6,
};
const POPOVER_LIST_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
const LABEL_FLEX_STYLE: CSSProperties = { flex: 1 };
function popoverAnchorStyle(anchorScreenX: number, anchorScreenY: number, anchorSizePx: number): CSSProperties {
  return {
    position: "absolute",
    left: anchorScreenX - anchorSizePx / 2,
    top: anchorScreenY - anchorSizePx / 2,
    width: anchorSizePx,
    height: anchorSizePx,
    pointerEvents: "none",
  };
}

export interface GhostRailDescriptor {
  id: string;
  systemMeasureId: string;
  partIds: string[];
  partLabels: string[];
  /** Hidden parts grouped by shared LayoutStaff. One row per inner array. */
  staffGroups: string[][];
  staffGroupLabels: string[];
  /** Parallel to staffGroups: true if that staff has music in the hidden range. */
  staffGroupHasMusic: boolean[];
  /** Centre x (page-margin centre) in score/layout pixels. */
  cx: number;
  /** Centre y (between adjacent visible staves) in score/layout pixels. */
  cy: number;
}

interface GhostRailOverlayProps {
  /** The multi-staff rail whose popover is open, or null when closed. */
  openRail: GhostRailDescriptor | null;
  zoom: number;
  scrollX: number;
  scrollY: number;
  /** Diameter of the canvas-painted ring; used to size the popover anchor. */
  ringSize: number;
  /** Clear the lifted state in ScoreCanvas (outside click / Escape). */
  onClose: () => void;
  /**
   * Toggle a single staff's visibility on the given system.
   * `nextVisible` is the desired new state.
   */
  onTogglePart: (systemMeasureId: string, partId: string, nextVisible: boolean) => void;
}

export function GhostRailOverlay({
  openRail,
  zoom,
  scrollX,
  scrollY,
  ringSize,
  onClose,
  onTogglePart,
}: GhostRailOverlayProps) {
  // Staff groups (by index) the user has flipped to visible since opening.
  const [shown, setShown] = useState<Set<number>>(() => new Set());

  const railId = openRail?.id ?? null;
  // Reset the per-session "shown" set whenever a different rail opens. This is
  // the React-recommended "adjust state during render" pattern (not an effect),
  // so it runs before paint with no cascading-render warning.
  const [prevRailId, setPrevRailId] = useState<string | null>(railId);
  if (railId !== prevRailId) {
    setPrevRailId(railId);
    setShown(new Set());
  }

  const toggleGroup = useCallback(
    (groupIndex: number) => {
      if (!openRail) return;
      const group = openRail.staffGroups[groupIndex];
      const firstPart = group?.[0];
      if (!firstPart) return;
      setShown((prev) => {
        const next = new Set(prev);
        const isCurrentlyShown = next.has(groupIndex);
        const nextVisible = !isCurrentlyShown;
        if (nextVisible) next.add(groupIndex);
        else next.delete(groupIndex);
        // Toggle via any one part on the staff — setStaffVisibilityInScore
        // expands to all sources on the same LayoutStaff automatically.
        onTogglePart(openRail.systemMeasureId, firstPart, nextVisible);
        return next;
      });
    },
    [openRail, onTogglePart],
  );

  if (!openRail) return null;

  const anchorScreenX = (openRail.cx - scrollX) * zoom;
  const anchorScreenY = (openRail.cy - scrollY) * zoom;
  const anchorSizePx = ringSize * zoom;

  return (
    <div style={OVERLAY_ROOT_STYLE}>
      <Popover.Root
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <Popover.Anchor asChild>
          <div style={popoverAnchorStyle(anchorScreenX, anchorScreenY, anchorSizePx)} />
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content side="right" sideOffset={8} align="center" style={POPOVER_CONTENT_STYLE}>
            <div style={POPOVER_HEADER_STYLE}>Hidden staves</div>
            <div style={POPOVER_LIST_STYLE}>
              {openRail.staffGroups.map((group, i) => {
                const isVisible = shown.has(i);
                const label = openRail.staffGroupLabels[i] ?? group.join(" / ");
                const hasMusic = openRail.staffGroupHasMusic[i] === true;
                return (
                  <ListRow
                    key={group.join("|")}
                    density="compact"
                    onClick={() => toggleGroup(i)}
                    tooltip={hasMusic ? `${label} — contains music that is currently hidden` : label}
                    leading={isVisible ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
                    trailing={
                      hasMusic ? (
                        <TriangleAlert size={14} color="rgb(220, 60, 60)" aria-label="Contains hidden music" />
                      ) : undefined
                    }
                  >
                    <span style={LABEL_FLEX_STYLE}>{label}</span>
                  </ListRow>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
