import { useMemo, type Dispatch, type SetStateAction } from "react";
import { computeSpatiumPx } from "@viritura/core";
import { ScoreView, ScoreViewer, type ScorePosition } from "@viritura/score-viewer-react";
import type { ClickDocument } from "./clickDocument";
import type { ClickScoreSettings } from "./ClickScoreControls";
import { clickPartMnx } from "./scoreViews";
import { ClickScoreInteractions } from "./ClickScoreInteractions";
import styles from "./ClickPage.module.css";

const SCORE_STYLE = { minHeight: 0 };
const VIEWER_STYLE = { background: "#fff" };
// Match the main editor's engraving coordinate scale; display zoom is independent.
const PX_PER_MM = 12;

interface ClickScoreProps {
  readonly document: ClickDocument;
  readonly position: Extract<ScorePosition, { measureIndex: number }>;
  readonly settings: ClickScoreSettings;
  readonly onSettingsChange: Dispatch<SetStateAction<ClickScoreSettings>>;
  readonly interactionEnabled: boolean;
  readonly onSelectMeasure: (measureIndex: number) => void;
}

export function ClickScore({
  document,
  position,
  settings,
  onSettingsChange,
  interactionEnabled,
  onSelectMeasure,
}: ClickScoreProps) {
  const view = document.scoreViews[settings.viewIndex]!;
  const pageSetup = view.pageSetup;
  const pageWidth = pageSetup.width * PX_PER_MM;
  const pageMargins = useMemo(
    () => ({
      top: pageSetup.margins.top * PX_PER_MM,
      right: pageSetup.margins.right * PX_PER_MM,
      bottom: pageSetup.margins.bottom * PX_PER_MM,
      left: pageSetup.margins.left * PX_PER_MM,
    }),
    [pageSetup],
  );
  const mnx = useMemo(
    () => (view.partIndex === undefined ? document.mnx : clickPartMnx(document.mnx, view.partIndex)),
    [document.mnx, view.partIndex],
  );
  return (
    <section className={styles.score} aria-label="Score">
      <ScoreViewer
        mnx={mnx}
        assetBaseUrl={import.meta.env.BASE_URL}
        useWorker
        bare
        pageBackground="transparent"
        style={VIEWER_STYLE}
        viewMode={settings.viewMode}
        contentAlign={settings.viewMode === "horizon" ? "start" : "page"}
        spreadFirstPage="paired"
        controls={false}
        scoreIndex={view.scoreIndex}
        pageWidth={pageWidth}
        pageHeight={pageSetup.height * PX_PER_MM}
        pageMargins={settings.viewMode === "horizon" ? undefined : pageMargins}
        staffSize={computeSpatiumPx(pageSetup, pageWidth)}
        zoom={settings.zoom}
        onZoomChange={(zoom) => onSettingsChange((previous) => ({ ...previous, zoom }))}
        fitMode={settings.fitMode}
        onFitModeChange={(fitMode) => onSettingsChange((previous) => ({ ...previous, fitMode }))}
        minZoom={0.05}
        maxZoom={16}
        className={styles.viewer}
        scoreStyle={SCORE_STYLE}
        loadingFallback={
          <p className={styles.scoreStatus} role="status">
            Loading score
          </p>
        }
        errorFallback={(error) => (
          <p className={styles.error} role="alert">
            {error.message}
          </p>
        )}
      >
        <ScoreView.Playhead position={position} follow={settings.viewMode === "horizon" ? true : "page"} />
        <ClickScoreInteractions enabled={interactionEnabled} onSelectMeasure={onSelectMeasure} />
      </ScoreViewer>
    </section>
  );
}
