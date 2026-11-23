import { useMemo, type Dispatch, type SetStateAction } from "react";
import { ScoreView, ScoreViewer, type ScorePosition } from "@viritura/score-viewer-react";
import type { ClickDocument } from "./clickDocument";
import type { ClickScoreSettings } from "./ClickScoreControls";
import { clickPartMnx } from "./scoreViews";
import styles from "./ClickPage.module.css";

const SCORE_STYLE = { minHeight: 0 };
const VIEWER_STYLE = { background: "#fff" };

interface ClickScoreProps {
  readonly document: ClickDocument;
  readonly position: Extract<ScorePosition, { measureIndex: number }>;
  readonly settings: ClickScoreSettings;
  readonly onSettingsChange: Dispatch<SetStateAction<ClickScoreSettings>>;
}

export function ClickScore({ document, position, settings, onSettingsChange }: ClickScoreProps) {
  const view = document.scoreViews[settings.viewIndex]!;
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
        defaultViewMode="horizon"
        controls={false}
        scoreIndex={view.scoreIndex}
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
        <ScoreView.Playhead position={position} follow />
      </ScoreViewer>
    </section>
  );
}
