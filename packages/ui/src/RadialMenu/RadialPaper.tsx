/**
 * SVG paper-material patterns and rim/divider overlays for `RadialMenu`.
 * Split out to keep RadialMenu.tsx's main component under the lint
 * max-lines-per-function threshold.
 */

import { PAPER_NOISE_DARK, PAPER_NOISE_LIGHT } from "./radialMenuHelpers";

/**
 * Paper material patterns. Each pattern is a cream base rect overlaid
 * with the same fractalNoise filter used for full <Paper> tiles, so
 * wedges read with the same fiber texture as the rest of the paper
 * vocabulary. Four patterns: 2 states (rest / hover) × 2 substrates
 * (light / dark). CSS picks the right one via [data-theme] selectors
 * on .wedgePath. Pattern coords use objectBoundingBox so the fiber
 * repeats at an absolute size regardless of wedge dimensions.
 */
export function RadialPaperPatterns(): React.ReactElement {
  return (
    <defs>
      <pattern id="paperFill" patternUnits="userSpaceOnUse" width={220} height={220}>
        <rect width={220} height={220} fill="#fbf8ef" />
        <image href={PAPER_NOISE_LIGHT} width={220} height={220} />
      </pattern>
      <pattern id="paperFillHover" patternUnits="userSpaceOnUse" width={220} height={220}>
        <rect width={220} height={220} fill="#fdfaf2" />
        <image href={PAPER_NOISE_LIGHT} width={220} height={220} />
      </pattern>
      <pattern id="paperFillDark" patternUnits="userSpaceOnUse" width={220} height={220}>
        <rect width={220} height={220} fill="#2c2922" />
        <image href={PAPER_NOISE_DARK} width={220} height={220} />
      </pattern>
      <pattern id="paperFillHoverDark" patternUnits="userSpaceOnUse" width={220} height={220}>
        <rect width={220} height={220} fill="#38332a" />
        <image href={PAPER_NOISE_DARK} width={220} height={220} />
      </pattern>
    </defs>
  );
}

interface RadialPaperRimProps {
  cx: number;
  cy: number;
  radius: number;
  innerRadius: number;
  startAngle: number;
  totalWeight: number;
  cumulativeWeight: number[];
  count: number;
  litEdgeClassName: string;
  dividerClassName: string;
}

/**
 * Paper rim + specular highlight — the SVG equivalent of the inset
 * shadows the <Paper> recipe uses:
 *
 *   inset 0 0 0 1px rgba(120,100,60,0.10)   → warm rim
 *   inset 0 1px 0   rgba(255,255,255,0.9)   → lit edge
 *
 * SVG <path> can't take inset box-shadow, so we paint these as actual
 * strokes over the donut. The warm rim outlines the outer + inner
 * circumferences (every paper surface has that warm edge). The
 * specular highlight lights only the arcs that face the light source:
 * top half of the outer circle (the dome facing up) and bottom half
 * of the inner circle (the hole's lower lip also faces up). This is
 * the physically correct lighting for a paper donut under overhead
 * room light.
 */
export function RadialPaperRim({
  cx,
  cy,
  radius,
  innerRadius,
  startAngle,
  totalWeight,
  cumulativeWeight,
  count,
  litEdgeClassName,
  dividerClassName,
}: RadialPaperRimProps): React.ReactElement {
  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(120, 100, 60, 0.22)" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={innerRadius} fill="none" stroke="rgba(120, 100, 60, 0.22)" strokeWidth={1} />
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="rgba(255, 255, 255, 0.9)"
        strokeWidth={1}
        className={litEdgeClassName}
      />
      <path
        d={`M ${cx + innerRadius} ${cy} A ${innerRadius} ${innerRadius} 0 0 1 ${cx - innerRadius} ${cy}`}
        fill="none"
        stroke="rgba(255, 255, 255, 0.9)"
        strokeWidth={1}
        className={litEdgeClassName}
      />
      {/* Radial dividers between wedges — one 1px line per boundary,
          painted as a single stroke (not per-wedge strokes which would
          double up at shared edges into a 2px dark seam). Same warm
          rim color as the outer/inner circumference so the dividers
          feel like part of the paper edge vocabulary. */}
      {count > 1 &&
        cumulativeWeight.slice(0, count).map((cw, i) => {
          const a = startAngle + (cw / totalWeight) * 2 * Math.PI;
          const x1 = cx + innerRadius * Math.cos(a);
          const y1 = cy + innerRadius * Math.sin(a);
          const x2 = cx + radius * Math.cos(a);
          const y2 = cy + radius * Math.sin(a);
          return (
            <line
              key={`div-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="rgba(120, 100, 60, 0.22)"
              strokeWidth={1}
              className={dividerClassName}
            />
          );
        })}
    </g>
  );
}
