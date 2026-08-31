/**
 * WriteStatusBar — Write-mode composition of the StatusBar shell.
 *
 * The status bar is auto-hidden / hover-revealed chrome, so it intentionally
 * carries no persistent informational content (selected note, score title,
 * cursor/hover debug) — those would be unreliable to read at a glance.
 * It holds only the active controls that the user reaches for:
 *
 *   - center: transient beat-count warning + repair/dismiss actions
 *   - right:  concert/written toggle, view-mode select, zoom controls
 *
 * Purely presentational: the caller pre-formats the zoom label and supplies
 * primitive props. Display-calibration and editor-specific Score wiring stay
 * in the editor — the ui lib only sees what it needs to render.
 */
import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import { ButtonGroup } from "../ButtonGroup/ButtonGroup";
import { StatusBar as StatusBarShell } from "./StatusBar";
import { StatusSelect } from "./StatusSelect";
import { StatusZoomControls } from "./StatusZoomControls";
import styles from "./WriteStatusBar.module.css";

export type ViewMode = "page" | "spread" | "spread-h" | "horizon";

export interface WriteStatusBarProps {
  /** Current zoom level (1.0 = 100%) */
  zoom: number;
  /** Pre-formatted zoom label, e.g. "100%". Caller owns formatting so the
   *  ui lib doesn't depend on the editor's display-calibration system. */
  zoomLabel: string;
  /** Minimum allowed zoom */
  minZoom: number;
  /** Maximum allowed zoom */
  maxZoom: number;
  /** Called when the user changes the zoom via the slider */
  onZoomChange: (zoom: number) => void;
  /** Called to reset zoom to 100% */
  onResetZoom: () => void;
  /** Called when user clicks the calibration button next to the zoom slider */
  onCalibrate?: () => void;
  /** Number of measures with beat count issues */
  beatCountIssueCount?: number;
  /** Called when user clicks "Repair" on beat count warning */
  onRepairMeasures?: () => void;
  /** Called when user clicks "Dismiss" on beat count warning */
  onDismissBeatCountWarnings?: () => void;
  /** Current view mode */
  viewMode?: ViewMode | undefined;
  /** Called when user toggles view mode */
  onViewModeChange?: ((mode: ViewMode) => void) | undefined;
  /** Whether written pitch is active (false = concert pitch) */
  useWritten?: boolean;
  /** Called when user toggles concert/written pitch */
  onConcertPitchToggle?: (useWritten: boolean) => void;
}

function renderCenter(
  beatCountIssueCount: number | undefined,
  onRepairMeasures: (() => void) | undefined,
  onDismissBeatCountWarnings: (() => void) | undefined,
): ReactNode {
  if (!beatCountIssueCount || beatCountIssueCount <= 0) return null;
  return (
    <span className={styles.warning}>
      ⚠ {beatCountIssueCount} measure{beatCountIssueCount > 1 ? "s" : ""} with incorrect beat count
      {onRepairMeasures && (
        <Button
          variant="link"
          size="sm"
          label="Repair"
          onClick={onRepairMeasures}
          tooltip="Auto-repair: pad underfull measures with rests, truncate overfull measures"
        />
      )}
      {onDismissBeatCountWarnings && (
        <Button
          variant="link"
          size="sm"
          label="Dismiss"
          onClick={onDismissBeatCountWarnings}
          tooltip="Dismiss warning (leave measures as-is, e.g. for cadenzas or pickup bars)"
        />
      )}
    </span>
  );
}

export function WriteStatusBar({
  zoom,
  zoomLabel,
  minZoom,
  maxZoom,
  onZoomChange,
  onResetZoom,
  onCalibrate,
  beatCountIssueCount,
  onRepairMeasures,
  onDismissBeatCountWarnings,
  viewMode = "page",
  onViewModeChange,
  useWritten,
  onConcertPitchToggle,
}: WriteStatusBarProps) {
  const right = (
    <>
      {onConcertPitchToggle && (
        <ButtonGroup
          options={[
            { value: "concert", label: "Concert" },
            { value: "written", label: "Written" },
          ]}
          value={useWritten ? "written" : "concert"}
          onChange={(v) => onConcertPitchToggle(v === "written")}
        />
      )}
      {onViewModeChange && (
        <StatusSelect
          value={viewMode}
          onChange={(v) => onViewModeChange(v as ViewMode)}
          options={[
            { value: "page", label: "Page" },
            { value: "spread", label: "Spread" },
            { value: "spread-h", label: "Spread (H)" },
            { value: "horizon", label: "Horizon" },
          ]}
          ariaLabel="View mode"
          tooltip="View mode"
        />
      )}
      <StatusZoomControls
        zoom={zoom}
        zoomLabel={zoomLabel}
        minZoom={minZoom}
        maxZoom={maxZoom}
        onZoomChange={onZoomChange}
        onResetZoom={onResetZoom}
        {...(onCalibrate ? { onCalibrate } : {})}
      />
    </>
  );

  const center = renderCenter(beatCountIssueCount, onRepairMeasures, onDismissBeatCountWarnings);

  return <StatusBarShell {...(center ? { center } : {})} right={right} />;
}
