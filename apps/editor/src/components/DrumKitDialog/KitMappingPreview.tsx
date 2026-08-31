import { useRef, useMemo, useState, useCallback, useEffect, type CSSProperties } from "react";
import { ScoreView, useScoreView } from "@viritura/score-viewer-react";
import { detectStaves, SpatialIndex, getElementType, type ElementBBox } from "@viritura/renderer";
import type { KitComponentEdit } from "./types";
import { buildKitSliceMnx, slicePageWidth, SLICE_SPATIUM } from "./drumKitSlice";
import styles from "./DrumKitStaff.module.css";

export interface KitMappingPreviewProps {
  readonly rows: readonly KitComponentEdit[];
}

/** Vertical padding (display-list px) kept around the music when cropping. */
const CROP_PAD = 8;

/** Cap zoom-to-fit so a small kit (few drums) doesn't enlarge unreasonably. */
const MAX_FIT_SCALE = 1.8;

/** Fixed height (px) of the preview box. The engraved kit slice is scaled to
 *  fit *within* this box (both axes), so the whole staff — including stems and
 *  notes above the lines — always shows without clipping or scrolling. */
const PREVIEW_BOX_HEIGHT = 132;

/** Don't paint a page fill — the music blends into the surface. */
const PAGE_STYLE: CSSProperties = { boxShadow: "none", background: "transparent" };

/** Fixed-height preview box; content is scaled to fit within it (both axes). */
const PREVIEW_WRAP_STYLE: CSSProperties = { height: PREVIEW_BOX_HEIGHT };

/**
 * Read-only percussion mapping preview. Renders the same engine-engraved kit
 * slice as {@link DrumKitStaff} (clef + staff + each notehead at its position
 * and shape) but with no interaction overlay — used to show a part's drum-kit
 * mapping inline (e.g. the Musicians ▸ Instruments roster) where editing is
 * deferred to the full Drum Kit dialog.
 */
export function KitMappingPreview({ rows }: KitMappingPreviewProps) {
  const sliceMnx = useMemo(() => buildKitSliceMnx(rows), [rows]);
  const pageWidth = useMemo(() => slicePageWidth(rows.length), [rows.length]);
  const [crop, setCrop] = useState<{ top: number; height: number; left: number; width: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setBox({ width: cr.width, height: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleBounds = useCallback((top: number, bottom: number, left: number, right: number) => {
    const cropTop = Math.max(0, top - CROP_PAD);
    const cropLeft = Math.max(0, left - CROP_PAD);
    setCrop({ top: cropTop, height: bottom + CROP_PAD - cropTop, left: cropLeft, width: right + CROP_PAD - cropLeft });
  }, []);

  // Zoom-to-fit within the box: scale by the smaller of the width/height ratios
  // (so the full staff fits both ways, capped so a tiny kit doesn't balloon),
  // then translate the cropped origin and center in the leftover space. A
  // single transform (origin top-left) over the page the engine laid out at its
  // natural margins.
  const scoreStyle = useMemo<CSSProperties>(() => {
    if (!crop || box.width <= 0 || box.height <= 0 || crop.width <= 0 || crop.height <= 0) {
      return { marginTop: 0, marginLeft: 0 };
    }
    const scale = Math.min(MAX_FIT_SCALE, box.width / crop.width, box.height / crop.height);
    const tx = Math.max(0, (box.width - crop.width * scale) / 2) - crop.left * scale;
    const ty = Math.max(0, (box.height - crop.height * scale) / 2) - crop.top * scale;
    return { transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "top left" };
  }, [crop, box]);

  return (
    <div ref={wrapRef} className={styles.previewWrap} style={PREVIEW_WRAP_STYLE}>
      <ScoreView
        mnx={sliceMnx}
        pageWidth={pageWidth}
        spatium={SLICE_SPATIUM}
        viewMode="page"
        className={styles.score}
        style={scoreStyle}
        pageBackground="transparent"
        pageStyle={PAGE_STYLE}
        loadingFallback={<div className={styles.loading}>Loading staff…</div>}
      >
        <StaffBoundsReporter onContentBounds={handleBounds} />
      </ScoreView>
    </div>
  );
}

interface BoundsProps {
  readonly onContentBounds: (top: number, bottom: number, left: number, right: number) => void;
}

/** Read-only sibling that measures the engraved music's content extent so the
 *  host can crop away the engine's page margins (mirrors the bounds reporting
 *  in `DrumKitStaff`'s overlay, minus all pointer interaction). */
function StaffBoundsReporter({ onContentBounds }: BoundsProps) {
  const { displayList } = useScoreView();
  const staff = useMemo(() => (displayList ? detectStaves(displayList)[0] : undefined), [displayList]);
  const index = useMemo(() => (displayList ? SpatialIndex.fromDisplayList(displayList) : null), [displayList]);
  const eventBoxes = useMemo<ElementBBox[]>(
    () => (index ? index.all.filter((e) => getElementType(e.id) === "event") : []),
    [index],
  );

  useEffect(() => {
    if (!staff) return;
    let top = staff.y;
    let bottom = staff.y + staff.height;
    let right = staff.xEnd;
    for (const b of eventBoxes) {
      top = Math.min(top, b.y);
      bottom = Math.max(bottom, b.y + b.height);
      right = Math.max(right, b.x + b.width);
    }
    onContentBounds(top, bottom, staff.x, right);
  }, [staff, eventBoxes, onContentBounds]);

  return null;
}
