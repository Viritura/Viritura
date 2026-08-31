/**
 * Single-wedge component for `RadialMenu`. Renders the wedge path plus
 * its icon + label inside the pie. Split out to keep RadialMenu's main
 * component function under the lint max-lines-per-function threshold.
 */

import { isValidElement, type ReactNode } from "react";
import styles from "./RadialMenu.module.css";
import type { RadialMenuItem } from "./radialMenuHelpers";
import { wedgePath } from "./radialMenuHelpers";

interface RadialMenuWedgeProps {
  item: RadialMenuItem;
  cx: number;
  cy: number;
  radius: number;
  innerRadius: number;
  a1: number;
  a2: number;
  isHovered: boolean;
  onClick: (id: string) => void;
  onHover: (id: string | null) => void;
}

export function RadialMenuWedge({
  item,
  cx,
  cy,
  radius,
  innerRadius,
  a1,
  a2,
  isHovered,
  onClick,
  onHover,
}: RadialMenuWedgeProps): React.ReactElement {
  const midAngle = (a1 + a2) / 2;

  // Icon + label as one stacked unit: icon at band center, label below
  const bandMidR = innerRadius + (radius - innerRadius) * 0.5;
  const ix = cx + bandMidR * Math.cos(midAngle);
  const iy = cy + bandMidR * Math.sin(midAngle);
  const isReactIcon = isValidElement(item.icon);
  const iconSize = (radius - innerRadius) * 0.6;
  // For React element icons, use a single foreignObject for both
  // icon and label — the browser handles spacing via flex layout.
  const foHeight = iconSize * 1.6; // enough room for icon + label
  const lx = ix;
  const ly = iy + 16;

  return (
    <g
      className={styles.wedge}
      onClick={() => onClick(item.id)}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
    >
      <path
        d={wedgePath(cx, cy, radius, innerRadius, a1, a2)}
        className={`${styles.wedgePath} ${isHovered ? styles.wedgeHover : ""}`}
      />
      <RadialMenuWedgeContent
        icon={item.icon}
        label={item.label}
        isReactIcon={isReactIcon}
        ix={ix}
        iy={iy}
        iconSize={iconSize}
        foHeight={foHeight}
        lx={lx}
        ly={ly}
      />
    </g>
  );
}

interface RadialMenuWedgeContentProps {
  icon: ReactNode | undefined;
  label: string;
  isReactIcon: boolean;
  ix: number;
  iy: number;
  iconSize: number;
  foHeight: number;
  lx: number;
  ly: number;
}

function RadialMenuWedgeContent({
  icon,
  label,
  isReactIcon,
  ix,
  iy,
  iconSize,
  foHeight,
  lx,
  ly,
}: RadialMenuWedgeContentProps): React.ReactElement {
  if (icon != null && isReactIcon) {
    /* Combined foreignObject: icon + label in a flex column.
       The browser handles spacing — no metric computation needed. */
    return (
      <foreignObject x={ix - iconSize / 2} y={iy - foHeight / 2} width={iconSize} height={foHeight}>
        <div className={styles.wedgeIconStack}>
          <div className={styles.wedgeIconInner}>{icon}</div>
          <span className={styles.wedgeLabelInner}>{label}</span>
        </div>
      </foreignObject>
    );
  }
  return (
    <>
      {icon != null && typeof icon === "string" && (
        <text x={ix} y={iy} textAnchor="middle" dominantBaseline="central" className={styles.wedgeIcon}>
          {icon}
        </text>
      )}
      <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className={styles.wedgeLabel}>
        {label}
      </text>
    </>
  );
}
