/**
 * StatusZoomControls — slider + clickable % chip + optional calibrate
 * button. Lives next to `StatusSelect` so editor surfaces (Write StatusBar,
 * Engrave/Publish PreviewStatusBar) compose the same zoom UX from the
 * same primitives.
 *
 * Display label is passed in by the caller (`zoomLabel`) so calibration-
 * dependent formatting stays an editor concern.
 */
import { useCallback } from "react";
import { Ruler } from "lucide-react";
import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import { Slider } from "../Slider/Slider";
import styles from "./StatusZoomControls.module.css";

export interface StatusZoomControlsProps {
  /** Current zoom level (1.0 = 100%) — drives the slider. */
  zoom: number;
  /** Pre-formatted percentage label (e.g. `"100%"`). */
  zoomLabel: string;
  /** Minimum allowed zoom. */
  minZoom: number;
  /** Maximum allowed zoom. */
  maxZoom: number;
  /** Called when user moves the slider. */
  onZoomChange: (zoom: number) => void;
  /** Called when user clicks the % readout to reset zoom. */
  onResetZoom: () => void;
  /**
   * Called when user clicks the calibration ruler button. When omitted,
   * the calibrate button is hidden (e.g. on surfaces that don't expose
   * physical-size calibration).
   */
  onCalibrate?: () => void;
  /** Width of the slider in px. @default 80 */
  sliderWidth?: number;
}

export function StatusZoomControls({
  zoom,
  zoomLabel,
  minZoom,
  maxZoom,
  onZoomChange,
  onResetZoom,
  onCalibrate,
  sliderWidth = 80,
}: StatusZoomControlsProps) {
  const handleSliderChange = useCallback((value: number) => onZoomChange(value), [onZoomChange]);

  return (
    <div className={styles.group}>
      <Slider
        min={minZoom}
        max={maxZoom}
        step={0.05}
        value={zoom}
        onChange={handleSliderChange}
        width={sliderWidth}
        ariaLabel="Zoom slider"
      />
      <Button
        variant="ghost"
        size="sm"
        label={zoomLabel}
        onClick={onResetZoom}
        tooltip="Reset zoom (100%)"
        ariaLabel="Reset zoom"
      />
      {onCalibrate && (
        <IconButton
          size="sm"
          tooltip="Calibrate display (set 100% to physical size)"
          aria-label="Calibrate display"
          onClick={onCalibrate}
        >
          <Ruler size={12} />
        </IconButton>
      )}
    </div>
  );
}
