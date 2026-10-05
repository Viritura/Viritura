import { useMemo, type CSSProperties } from "react";
import { ScoreView } from "@viritura/score-viewer-react";
import { transpositionPreviewScore } from "./previewScore";
import styles from "./TranspositionPitchFields.module.css";

const PAGE_STYLE: CSSProperties = { background: "transparent", boxShadow: "none" };
const MARGINS = { top: 30, right: 16, bottom: 16, left: 16 };

export function TranspositionPreview({
  instrumentId,
  halfSteps,
  staffDistance,
  keyFifthsFlipAt,
}: {
  instrumentId?: string;
  halfSteps: number;
  staffDistance: number;
  keyFifthsFlipAt?: number;
}) {
  const mnx = useMemo(
    () =>
      transpositionPreviewScore(instrumentId, {
        interval: { halfSteps, staffDistance },
        ...(keyFifthsFlipAt !== undefined ? { keyFifthsFlipAt } : {}),
      }),
    [instrumentId, halfSteps, staffDistance, keyFifthsFlipAt],
  );
  return (
    <div className={styles.previews}>
      {["Concert pitch", "Written pitch"].map((label, scoreIndex) => (
        <figure key={label} className={styles.preview}>
          <figcaption>{label}</figcaption>
          <ScoreView
            mnx={mnx}
            scoreIndex={scoreIndex}
            pageWidth={340}
            pageHeight={170}
            pageMargins={MARGINS}
            spatium={7}
            viewMode="page"
            zoom="fit-width"
            bare
            pageStyle={PAGE_STYLE}
            pageBackground="transparent"
            loadingFallback={<p role="status">Loading notation preview…</p>}
            errorFallback={(error) => <p role="alert">Notation preview failed: {error.message}</p>}
          />
        </figure>
      ))}
    </div>
  );
}
