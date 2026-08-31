import type { CSSProperties } from "react";
import styles from "./Slider.module.css";
import { withTooltip } from "../Tooltip/withTooltip";

export interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  /** Accessible label */
  ariaLabel?: string;
  /** Id of an element naming this slider (e.g. a `SettingsRow` label). */
  ariaLabelledBy?: string;
  /** Id of an element describing this slider (e.g. a `SettingsRow` description). */
  ariaDescribedBy?: string;
  /** Id applied to the range input, so an external `<label htmlFor>` can name it. */
  id?: string;
  /** Tooltip text. Rendered through `<Tooltip>` (not the native browser title). */
  tooltip?: string;
  /** CSS width of the slider track. Defaults to "100%". */
  width?: number | string;
  /**
   * When provided AND `min < center < max`, the slider renders in
   * bipolar mode: the fill grows outward from the `center` detent
   * (cut to the left, boost to the right). Use for ±-valued ranges
   * like EQ gain / pan / detune where the natural zero is in the
   * middle. Omit for unipolar controls (e.g. volume `0..1`); fill
   * grows from the left edge.
   */
  center?: number;
  className?: string;
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  id,
  tooltip,
  width,
  center,
  className,
}: SliderProps) {
  const range = max - min;
  const pct = range > 0 ? Math.max(0, Math.min(100, ((value - min) / range) * 100)) : 0;
  const bipolar = center !== undefined && center > min && center < max;
  const centerPct = bipolar ? ((center - min) / range) * 100 : 0;
  const fillStart = bipolar ? Math.min(pct, centerPct) : 0;
  const fillEnd = bipolar ? Math.max(pct, centerPct) : pct;

  const style: CSSProperties = {
    "--fill": `${pct}%`,
    "--fill-start": `${fillStart}%`,
    "--fill-end": `${fillEnd}%`,
    "--center": `${centerPct}%`,
    ...(width !== undefined ? { width } : {}),
  } as CSSProperties;

  return withTooltip(
    <input
      type="range"
      id={id}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={[styles.slider, className].filter(Boolean).join(" ")}
      style={style}
      aria-label={ariaLabelledBy === undefined ? (ariaLabel ?? tooltip) : undefined}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      data-bipolar={bipolar || undefined}
    />,
    tooltip,
  );
}
