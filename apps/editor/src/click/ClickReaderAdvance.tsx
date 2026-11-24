import { useEffect, useMemo, useRef } from "react";
import { useScoreView, type ScorePosition } from "@viritura/score-viewer-react";
import { readerAdvance } from "./readerAdvance";
import styles from "./ClickPage.module.css";

interface ClickReaderAdvanceProps {
  readonly active: boolean;
  readonly position: Extract<ScorePosition, { measureIndex: number }>;
}

export function ClickReaderAdvance({ active, position }: ClickReaderAdvanceProps) {
  const { engine, displayList, pagePositions, viewMode, zoom } = useScoreView();
  const canvas = useRef<HTMLCanvasElement>(null);
  const geometry = useMemo(() => {
    if (!active || viewMode === "horizon" || !engine || !displayList) return undefined;
    return {
      measures: engine.measures(displayList),
      systems: engine.systems(displayList),
      pages: engine.measure(displayList).pages,
    };
  }, [active, viewMode, engine, displayList]);
  const playhead = geometry && engine && displayList ? engine.playhead(displayList, position) : null;
  const page = playhead?.page;
  const systemIndex = playhead?.systemIndex;
  const advance = useMemo(
    () =>
      geometry && page !== undefined && systemIndex !== undefined
        ? readerAdvance(
            viewMode,
            { page, systemIndex },
            position.measureIndex,
            geometry.measures,
            geometry.systems,
            geometry.pages.map((page) => page.height),
          )
        : undefined,
    [geometry, page, systemIndex, viewMode, position.measureIndex],
  );
  const target = advance && pagePositions[advance.targetPage];
  const source = advance && geometry?.pages[advance.sourcePage];
  const sourcePage = advance?.sourcePage;
  const width = target?.width ?? 0;
  const height = target ? target.height * advance!.fraction : 0;

  useEffect(() => {
    const element = canvas.current;
    if (!element || !engine || !displayList || sourcePage === undefined || !source) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.ceil(width * ratio);
    element.height = Math.ceil(height * ratio);
    const context = element.getContext("2d");
    if (!context) throw new Error("Cannot create the reader advance canvas");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, element.width, element.height);
    context.scale(ratio * zoom, ratio * zoom);
    engine.paint(context, displayList, {
      page: sourcePage,
      region: { x: 0, y: 0, width: width / zoom, height: height / zoom },
    });
  }, [engine, displayList, sourcePage, source, width, height, zoom]);

  if (!advance || !target) return null;
  const previewStyle = { left: target.x, top: target.y, width, height };
  return (
    <canvas
      ref={canvas}
      className={styles.readerAdvance}
      aria-label={`Advance preview of page ${advance.sourcePage + 1}`}
      data-reader-source-page={advance.sourcePage}
      data-reader-target-page={advance.targetPage}
      style={previewStyle}
    />
  );
}
