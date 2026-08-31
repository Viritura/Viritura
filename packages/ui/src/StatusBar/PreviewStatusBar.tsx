/**
 * PreviewStatusBar — shared status bar for ScoreCanvas-based print previews
 * (Engrave + Publish). Owns no state; pure presentational composition of
 * the StatusBar shell + optional StatusSelect + ButtonGroup + StatusZoomControls.
 * The caller pre-formats `zoomLabel` so the ui lib stays decoupled from
 * the editor's display-calibration system.
 *
 * Slot policy (right cluster, left-to-right):
 *   1. Concert/Written toggle  — only if `onConcertPitchToggle` is supplied
 *   2. View-mode select        — only if `onViewModeChange` is supplied
 *   3. Zoom controls           — always
 *
 * This lets engrave/review surfaces (zoom + concert) and publish surfaces
 * (zoom + view mode) share one composition.
 */
import { ButtonGroup } from "../ButtonGroup/ButtonGroup";
import { StatusBar } from "./StatusBar";
import { StatusSelect } from "./StatusSelect";
import { StatusZoomControls } from "./StatusZoomControls";

export type PreviewViewMode = "page" | "spread" | "spread-h";

export interface PreviewStatusBarProps {
  /** Current canvas zoom (0..1, mirrored from `onViewportChange`). */
  zoom: number;
  /** Pre-formatted zoom label, e.g. "100%". */
  zoomLabel: string;
  /** Minimum allowed zoom (drives the slider). */
  minZoom: number;
  /** Maximum allowed zoom (drives the slider). */
  maxZoom: number;
  /** Active preview view mode (only meaningful if `onViewModeChange` is set). */
  viewMode?: PreviewViewMode;

  onZoomChange: (zoom: number) => void;
  /** Called when user clicks the zoom % chip — jump to physical (100%) size. */
  onResetZoom: () => void;
  /** Optional view-mode select; omit to hide. */
  onViewModeChange?: (mode: PreviewViewMode) => void;
  /** Called when user clicks the calibrate (ruler) chip. Optional. */
  onCalibrate?: () => void;

  /** Whether written pitch is active (false = concert pitch). */
  useWritten?: boolean;
  /** Optional concert/written toggle; omit to hide. */
  onConcertPitchToggle?: (useWritten: boolean) => void;

  /** data-testid forwarded to the root element. */
  testId?: string;
}

export function PreviewStatusBar({
  zoom,
  zoomLabel,
  minZoom,
  maxZoom,
  viewMode = "page",
  onZoomChange,
  onResetZoom,
  onViewModeChange,
  onCalibrate,
  useWritten,
  onConcertPitchToggle,
  testId,
}: PreviewStatusBarProps) {
  return (
    <StatusBar
      testId={testId}
      right={
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
              onChange={(v) => onViewModeChange(v as PreviewViewMode)}
              options={[
                { value: "page", label: "Page" },
                { value: "spread", label: "Spread" },
                { value: "spread-h", label: "Spread (H)" },
              ]}
              ariaLabel="Preview view mode"
              tooltip="Switch between page, spread (vertical), and spread (horizontal) layouts"
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
      }
    />
  );
}
