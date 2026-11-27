import { WriteStatusBar } from "@viritura/ui";
import type { ScoreFitMode, ScoreViewMode } from "@viritura/score-viewer-react";
import { formatZoomPercent, getLifeSizeZoom, useCalibrationRerender } from "../zoomScale";
import { MIN_ZOOM, MAX_ZOOM } from "../viewport";
import styles from "./ClickView.module.css";

export interface ClickScoreSettings {
  readonly viewIndex: number;
  readonly viewMode: ScoreViewMode;
  readonly zoom: number;
  readonly fitMode: ScoreFitMode;
  readonly fitRequest: number;
  readonly useWritten?: boolean;
}

interface ClickScoreControlsProps {
  readonly settings: ClickScoreSettings;
  readonly onChange: (settings: ClickScoreSettings) => void;
}

export function ClickScoreControls({ settings, onChange }: ClickScoreControlsProps) {
  useCalibrationRerender();
  const fitMode = settings.viewMode === "horizon" ? "height" : "page";
  return (
    <WriteStatusBar
      ariaLabel="Click score view"
      className={styles.statusBar}
      viewMode={
        settings.viewMode === "spread-horizontal" || settings.viewMode === "horizontal" ? "spread-h" : settings.viewMode
      }
      onViewModeChange={(viewMode) =>
        onChange({
          ...settings,
          viewMode: viewMode === "spread-h" ? "spread-horizontal" : viewMode,
          fitMode: viewMode === "horizon" ? "height" : "page",
        })
      }
      useWritten={settings.useWritten}
      onConcertPitchToggle={(useWritten) => onChange({ ...settings, useWritten })}
      zoom={settings.zoom}
      zoomLabel={formatZoomPercent(settings.zoom)}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      onZoomChange={(zoom) => onChange({ ...settings, fitMode: "none", zoom })}
      onResetZoom={() => onChange({ ...settings, fitMode: "none", zoom: getLifeSizeZoom() })}
      onZoomToFit={() => onChange({ ...settings, fitMode, fitRequest: settings.fitRequest + 1 })}
      fitActive={settings.fitMode === fitMode}
    />
  );
}
