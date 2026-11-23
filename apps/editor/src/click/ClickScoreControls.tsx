import { Minus, Plus } from "lucide-react";
import { Button, Select } from "@viritura/ui";
import type { ScoreFitMode, ScoreViewMode } from "@viritura/score-viewer-react";
import type { ClickScoreView } from "./scoreViews";
import styles from "./ClickPage.module.css";

export interface ClickScoreSettings {
  readonly viewIndex: number;
  readonly viewMode: ScoreViewMode;
  readonly zoom: number;
  readonly fitMode: ScoreFitMode;
}

interface ClickScoreControlsProps {
  readonly views: readonly ClickScoreView[];
  readonly settings: ClickScoreSettings;
  readonly onChange: (settings: ClickScoreSettings) => void;
}

const VIEW_MODES: readonly { value: ScoreViewMode; label: string }[] = [
  { value: "page", label: "Page" },
  { value: "spread", label: "Spread" },
  { value: "spread-horizontal", label: "Spread (H)" },
  { value: "horizon", label: "Horizon" },
];

export function ClickScoreControls({ views, settings, onChange }: ClickScoreControlsProps) {
  return (
    <div className={styles.viewControls} role="group" aria-label="Score view">
      <Select
        aria-label="Score or part"
        value={String(settings.viewIndex)}
        onValueChange={(value) => onChange({ ...settings, viewIndex: Number(value) })}
        options={views.map((view, index) => ({ value: String(index), label: view.label }))}
        disabled={views.length < 2}
        fullWidth={false}
        className={styles.scoreSelect}
      />
      <Select
        aria-label="View mode"
        value={settings.viewMode}
        onValueChange={(value) => {
          const mode = VIEW_MODES.find((option) => option.value === value);
          if (!mode) throw new Error(`Unknown score view mode: ${value}`);
          onChange({ ...settings, viewMode: mode.value });
        }}
        options={VIEW_MODES}
        fullWidth={false}
      />
      <Button
        variant="ghost"
        shape="icon"
        ariaLabel="Zoom out"
        disabled={settings.zoom <= 0.05}
        onClick={() => onChange({ ...settings, fitMode: "none", zoom: Math.max(0.05, settings.zoom / 1.2) })}
      >
        <Minus size={18} aria-hidden="true" />
      </Button>
      <output aria-label="Score zoom" className={styles.zoomValue}>
        {Math.round(settings.zoom * 100)}%
      </output>
      <Button
        variant="ghost"
        shape="icon"
        ariaLabel="Zoom in"
        disabled={settings.zoom >= 16}
        onClick={() => onChange({ ...settings, fitMode: "none", zoom: Math.min(16, settings.zoom * 1.2) })}
      >
        <Plus size={18} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        ariaLabel="Zoom to fit"
        aria-pressed={settings.fitMode === "height"}
        onClick={() => onChange({ ...settings, fitMode: "height" })}
      >
        Fit
      </Button>
    </div>
  );
}
