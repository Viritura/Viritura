import { ScoreView, ScoreViewer, type ScorePosition } from "@viritura/score-viewer-react";
import type { ClickDocument } from "./clickDocument";
import styles from "./ClickPage.module.css";

const SCORE_STYLE = { minHeight: 0 };

interface ClickScoreProps {
  readonly document: ClickDocument;
  readonly position: Extract<ScorePosition, { measureIndex: number }>;
}

export function ClickScore({ document, position }: ClickScoreProps) {
  return (
    <section className={styles.score} aria-label="Score">
      <ScoreViewer
        mnx={document.mnx}
        assetBaseUrl={import.meta.env.BASE_URL}
        useWorker
        defaultViewMode="horizon"
        controls={false}
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
