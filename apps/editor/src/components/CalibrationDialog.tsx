import { useEffect, useState, type CSSProperties } from "react";
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogActions,
  DialogCancelButton,
  DialogPrimaryButton,
  Button,
  Slider,
  ButtonGroup,
} from "@viritura/ui";
import { DEFAULT_CSS_PX_PER_MM, getCssPxPerMm, setCssPxPerMm } from "../zoomScale";

type Mode = "card" | "inch" | "cm";

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "card", label: "Credit Card" },
  { value: "inch", label: "Inch Ruler" },
  { value: "cm", label: "Cm Ruler" },
];

interface CalibrationDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Dimensions of common reference objects (always physical, in mm).
 * - Credit card: ISO/IEC 7810 ID-1 standard, 85.60 × 53.98 mm, 3.18 mm corner radius.
 *   Every credit/debit/ID card on Earth follows this.
 */
const CARD_W_MM = 85.6;
const CARD_H_MM = 53.98;
const CARD_RADIUS_MM = 3.18;

const CALIBRATION_INTRO_STYLE: CSSProperties = { margin: "0 0 12px", fontSize: "var(--type-small-size)", opacity: 0.8 };
const CALIBRATION_MODES_ROW_STYLE: CSSProperties = { display: "flex", gap: 8, marginBottom: 16 };
const CALIBRATION_PREVIEW_STYLE: CSSProperties = {
  background: "var(--surface-sunken)",
  boxShadow: "var(--inset-soft)",
  borderRadius: 8,
  padding: 24,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  minHeight: 200,
  overflow: "auto",
};
const CALIBRATION_SLIDER_WRAP_STYLE: CSSProperties = { marginTop: 16 };
const CALIBRATION_SLIDER_LABEL_STYLE: CSSProperties = {
  display: "block",
  fontSize: "var(--type-small-size)",
  marginBottom: 8,
};
const CALIBRATION_SLIDER_FOOTER_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "var(--type-eyebrow-size)",
  opacity: 0.7,
  marginTop: 4,
};
const CALIBRATION_TIP_STYLE: CSSProperties = { marginTop: 12, fontSize: "var(--type-eyebrow-size)", opacity: 0.6 };
const CALIBRATION_ACTIONS_WRAP_STYLE: CSSProperties = { padding: "0 1rem 1rem" };

/**
 * Calibration dialog — user picks a reference object (credit card,
 * inch ruler, or cm ruler), then drags a slider until the on-screen
 * shape matches a real one held against the screen. Stores the
 * resulting `cssPxPerMm` in localStorage.
 *
 * This is OS-/browser-agnostic: it directly measures the physical size
 * of a CSS pixel, sidestepping all OS scaling, browser zoom, and DPI
 * detection issues.
 */
export function CalibrationDialog({ open, onClose }: CalibrationDialogProps) {
  const [mode, setMode] = useState<Mode>("card");
  const [cssPxPerMm, setLocal] = useState<number>(getCssPxPerMm());

  // Reset to current saved value each time the dialog opens.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    if (open) setLocal(getCssPxPerMm());
  }, [open]);

  const handleApply = () => {
    setCssPxPerMm(cssPxPerMm);
    onClose();
  };

  const handleResetDefault = () => {
    setLocal(DEFAULT_CSS_PX_PER_MM);
  };

  const dpi = (cssPxPerMm * 25.4).toFixed(1);
  const offsetFromDefault = ((cssPxPerMm / DEFAULT_CSS_PX_PER_MM - 1) * 100).toFixed(1);

  return (
    <Dialog open={open} onClose={onClose} size="wide">
      <DialogHeader title="Calibrate Display" onClose={onClose} />
      <DialogBody>
        <p style={CALIBRATION_INTRO_STYLE}>
          Hold a real reference object up to your screen and drag the slider until the on-screen shape matches its
          physical size. This calibrates your display so that &ldquo;100%&rdquo; zoom renders music at true life size.
        </p>

        <div style={CALIBRATION_MODES_ROW_STYLE}>
          <ButtonGroup<Mode> options={MODE_OPTIONS} value={mode} onChange={setMode} />
        </div>

        <div style={CALIBRATION_PREVIEW_STYLE}>
          {mode === "card" && <CreditCardSvg cssPxPerMm={cssPxPerMm} />}
          {mode === "inch" && <RulerSvg cssPxPerMm={cssPxPerMm} unit="inch" />}
          {mode === "cm" && <RulerSvg cssPxPerMm={cssPxPerMm} unit="cm" />}
        </div>

        <div style={CALIBRATION_SLIDER_WRAP_STYLE}>
          <label style={CALIBRATION_SLIDER_LABEL_STYLE}>Adjust until it matches your physical reference:</label>
          <Slider
            min={2.0}
            max={8.0}
            step={0.01}
            value={cssPxPerMm}
            onChange={setLocal}
            ariaLabel="Calibration scale"
          />
          <div style={CALIBRATION_SLIDER_FOOTER_STYLE}>
            <span>Smaller</span>
            <span>
              {cssPxPerMm.toFixed(2)} CSS px/mm · {dpi} DPI · {offsetFromDefault}% vs. default
            </span>
            <span>Larger</span>
          </div>
        </div>

        <div style={CALIBRATION_TIP_STYLE}>
          Tip: this only affects the on-screen &ldquo;100%&rdquo; reference. PDF export and printing always use absolute
          physical dimensions regardless of this setting.
        </div>
      </DialogBody>
      <div style={CALIBRATION_ACTIONS_WRAP_STYLE}>
        <DialogActions>
          <Button onClick={handleResetDefault} variant="ghost">
            Reset to default
          </Button>
          <DialogCancelButton>Cancel</DialogCancelButton>
          <DialogPrimaryButton onClick={handleApply}>Save calibration</DialogPrimaryButton>
        </DialogActions>
      </div>
    </Dialog>
  );
}

function CreditCardSvg({ cssPxPerMm }: { cssPxPerMm: number }) {
  const w = CARD_W_MM * cssPxPerMm;
  const h = CARD_H_MM * cssPxPerMm;
  const r = CARD_RADIUS_MM * cssPxPerMm;
  const guide = 24; // px each corner-extension reaches past the card edges
  const pad = guide + 8;
  const svgW = w + pad * 2;
  const svgH = h + pad * 2;
  const x0 = pad;
  const y0 = pad;
  const x1 = pad + w;
  const y1 = pad + h;

  return (
    <svg width={svgW} height={svgH} role="img" aria-label="Credit card reference (85.60 × 53.98 mm)">
      <defs>
        <linearGradient id="cardGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3a4a6a" />
          <stop offset="100%" stopColor="#1a2a4a" />
        </linearGradient>
      </defs>

      {/* Card body — opaque, like a real card */}
      <rect x={x0} y={y0} width={w} height={h} rx={r} ry={r} fill="url(#cardGrad)" stroke="#000" strokeWidth={1} />
      <text
        x={x0 + w / 2}
        y={y0 + h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="rgba(255,255,255,0.7)"
        fontSize={Math.min(w / 12, 18)}
        fontFamily="system-ui, sans-serif"
      >
        85.60 × 53.98 mm
      </text>

      {/* Full guide rectangle along the card edges, plus corner extensions
          past each side. The rectangle gives precise alignment along straight
          edges; the extensions remain visible after a physical card covers
          the rectangle, so the user can still see if it's centered. */}
      <g stroke="#d33" strokeWidth={1} shapeRendering="crispEdges" fill="none">
        <rect x={x0} y={y0} width={w} height={h} />
        {/* Top edge extensions */}
        <line x1={x0 - guide} y1={y0} x2={x0} y2={y0} />
        <line x1={x1} y1={y0} x2={x1 + guide} y2={y0} />
        {/* Bottom edge extensions */}
        <line x1={x0 - guide} y1={y1} x2={x0} y2={y1} />
        <line x1={x1} y1={y1} x2={x1 + guide} y2={y1} />
        {/* Left edge extensions */}
        <line x1={x0} y1={y0 - guide} x2={x0} y2={y0} />
        <line x1={x0} y1={y1} x2={x0} y2={y1 + guide} />
        {/* Right edge extensions */}
        <line x1={x1} y1={y0 - guide} x2={x1} y2={y0} />
        <line x1={x1} y1={y1} x2={x1} y2={y1 + guide} />
      </g>

      {/* Caption under the card */}
      <text
        x={svgW / 2}
        y={y1 + guide + 16}
        textAnchor="middle"
        fontSize={11}
        fontFamily="system-ui, sans-serif"
        fill="#666"
      >
        Align the flat edges of a physical credit/debit/ID card to the red rectangle
      </text>
    </svg>
  );
}

function RulerSvg({ cssPxPerMm, unit }: { cssPxPerMm: number; unit: "inch" | "cm" }) {
  // Define rulers in integer tick counts to avoid all floating-point drift.
  // Inch ruler: 6 inches, 16 sub-ticks per inch (1/16" resolution).
  // Cm ruler:   15 cm,    10 sub-ticks per cm (1mm resolution).
  const majorUnits = unit === "inch" ? 6 : 15;
  const ticksPerMajor = unit === "inch" ? 16 : 10;
  const ticksPerMid = unit === "inch" ? 4 : 5; // quarter-inch / half-cm
  const mmPerMajor = unit === "inch" ? 25.4 : 10;
  const totalTicks = majorUnits * ticksPerMajor;

  const widthPx = majorUnits * mmPerMajor * cssPxPerMm;
  const heightPx = 60;

  const ticks: Array<{ x: number; h: number; label?: string }> = [];
  for (let i = 0; i <= totalTicks; i++) {
    const x = (i / totalTicks) * widthPx;
    const isMajor = i % ticksPerMajor === 0;
    const isMid = !isMajor && i % ticksPerMid === 0;
    const h = isMajor ? 22 : isMid ? 14 : 8;
    const label = isMajor ? String(i / ticksPerMajor) : undefined;
    ticks.push({ x, h, label });
  }

  return (
    <svg
      width={widthPx}
      height={heightPx}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`${majorUnits}-${unit === "inch" ? "inch" : "cm"} ruler reference`}
    >
      <rect x={0} y={0} width={widthPx} height={heightPx} fill="#fff8dc" stroke="#000" strokeWidth={1} />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={t.x} y1={heightPx} x2={t.x} y2={heightPx - t.h} stroke="#000" strokeWidth={1} />
          {t.label !== undefined && (
            <text
              x={t.x}
              y={heightPx - t.h - 6}
              textAnchor="middle"
              fontSize={11}
              fontFamily="system-ui, sans-serif"
              fill="#000"
              shapeRendering="auto"
            >
              {t.label}
            </text>
          )}
        </g>
      ))}
      <text
        x={widthPx - 4}
        y={14}
        textAnchor="end"
        fontSize={10}
        fontFamily="system-ui, sans-serif"
        fill="#666"
        shapeRendering="auto"
      >
        {unit === "inch" ? "inches" : "cm"}
      </text>
    </svg>
  );
}
