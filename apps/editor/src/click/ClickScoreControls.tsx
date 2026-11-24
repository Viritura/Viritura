import { Button, StatusBar, StatusSelect, StatusZoomControls } from "@viritura/ui";
import type { ScoreFitMode, ScoreViewMode } from "@viritura/score-viewer-react";
import styles from "./ClickView.module.css";

export interface ClickScoreSettings {
  readonly viewIndex: number;
  readonly viewMode: ScoreViewMode;
  readonly zoom: number;
  readonly fitMode: ScoreFitMode;
  readonly fitRequest: number;
}

interface ClickScoreControlsProps {
  readonly settings: ClickScoreSettings;
  readonly onChange: (settings: ClickScoreSettings) => void;
}

const VIEW_MODES: readonly { value: ScoreViewMode; label: string }[] = [
  { value: "page", label: "Page" },
  { value: "spread", label: "Spread" },
  { value: "spread-horizontal", label: "Spread (H)" },
  { value: "horizon", label: "Horizon" },
];

export function ClickScoreControls({ settings, onChange }: ClickScoreControlsProps) {
  const fitMode = settings.viewMode === "horizon" ? "height" : "page";
  return (
    <StatusBar
      ariaLabel="Click score view"
      className={styles.statusBar}
      right={
        <>
          <StatusSelect
            ariaLabel="View mode"
            value={settings.viewMode}
            onChange={(value) => {
              const mode = VIEW_MODES.find((option) => option.value === value);
              if (!mode) throw new Error(`Unknown score view mode: ${value}`);
              onChange({ ...settings, viewMode: mode.value, fitMode: mode.value === "horizon" ? "height" : "page" });
            }}
            options={VIEW_MODES}
          />
          <StatusZoomControls
            zoom={settings.zoom}
            zoomLabel={`${Math.round(settings.zoom * 100)}%`}
            minZoom={0.05}
            maxZoom={16}
            onZoomChange={(zoom) => onChange({ ...settings, fitMode: "none", zoom })}
            onResetZoom={() => onChange({ ...settings, fitMode: "none", zoom: 1 })}
          />
          <output aria-label="Score zoom" className={styles.srOnly}>
            {Math.round(settings.zoom * 100)}%
          </output>
          <Button
            variant="ghost"
            size="sm"
            ariaLabel="Zoom to fit"
            aria-pressed={settings.fitMode === fitMode}
            onClick={() => onChange({ ...settings, fitMode, fitRequest: settings.fitRequest + 1 })}
          >
            Fit
          </Button>
        </>
      }
    />
  );
}
