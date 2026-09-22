import { useMemo, type CSSProperties } from "react";
import { resolveChordSymbol, UNSUPPORTED_CHORD_MESSAGE, type ChordSymbol, type Score } from "@viritura/core";
import type { DisplayList, SpatialIndex } from "@viritura/renderer";
import { Tooltip, type WriteViewMode } from "@viritura/ui";
import type { MeasureSelectionPoint } from "../../store/selectionStore";
import { globalChordForElement } from "./chordFeedback";
import { pointerToMeasure } from "./hitTesting";
import { chordSelectionPoint } from "./elementSelection";
import { computePagePlacements, placementCommandOffset } from "./viewportGeometry";
import type { ViewportInfo } from "./types";
import styles from "./UnsupportedChordOverlay.module.css";

interface UnsupportedChordOverlayProps {
  score: Score | null;
  displayList: DisplayList | null;
  spatialIndex: SpatialIndex | null;
  displayListVersion: number;
  viewport: ViewportInfo;
  viewMode: WriteViewMode;
  printPreview: boolean;
  selectedScoreIndex?: number;
  onSelect: (id: string, measureAnchor?: MeasureSelectionPoint) => void;
}

export function UnsupportedChordOverlay({
  score,
  displayList,
  spatialIndex,
  displayListVersion,
  viewport,
  viewMode,
  printPreview,
  selectedScoreIndex = 0,
  onSelect,
}: UnsupportedChordOverlayProps) {
  const warnings = useMemo(() => {
    if (printPreview || !displayList || !spatialIndex || displayListVersion === 0) return [];
    const placements = computePagePlacements(displayList, viewMode);
    const unsupported = new Map<ChordSymbol, boolean>();
    return spatialIndex.all.flatMap((box) => {
      const chord = globalChordForElement(score, box.id);
      if (!chord) return [];
      // Copies share the same authored symbol; resolve only once per publication.
      let warning = unsupported.get(chord);
      if (warning === undefined) {
        warning = resolveChordSymbol(chord).status === "unsupported";
        unsupported.set(chord, warning);
      }
      if (!warning) return [];
      const measureAnchor = pointerToMeasure(box.x + box.width / 2, box.y + box.height / 2, displayList.measureBounds);
      const page = placements.find((p) => box.y >= p.engineYOffset && box.y < p.engineYOffset + p.height);
      const offset = page ? placementCommandOffset(page) : { dx: 0, dy: 0 };
      return [{ ...box, x: box.x + offset.dx, y: box.y + offset.dy, measureAnchor }];
    });
  }, [score, displayList, spatialIndex, displayListVersion, viewMode, printPreview]);

  return (
    <div className={styles.root}>
      {warnings.map((box, index) => {
        const style: CSSProperties = {
          left: (box.x - viewport.scrollX) * viewport.zoom,
          top: (box.y - viewport.scrollY) * viewport.zoom,
          width: box.width * viewport.zoom,
          height: box.height * viewport.zoom,
        };
        return (
          <div key={`${box.id}:${index}`} className={styles.outline} style={style} data-chord-warning={box.id}>
            <Tooltip content={UNSUPPORTED_CHORD_MESSAGE}>
              {/* eslint-disable-next-line no-restricted-syntax -- positioned warning marker anchored to engine geometry, not a toolbar button. */}
              <button
                type="button"
                className={styles.marker}
                aria-label={UNSUPPORTED_CHORD_MESSAGE}
                onClick={() => {
                  if (box.measureAnchor && score) {
                    onSelect(box.id, chordSelectionPoint(score, box.measureAnchor, selectedScoreIndex, displayList));
                  } else onSelect(box.id);
                }}
              >
                <span aria-hidden="true">!</span>
              </button>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
