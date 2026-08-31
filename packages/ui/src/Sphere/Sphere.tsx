/**
 * Sphere — Viritura's "object" material for spatial / 3D contexts.
 *
 * Where {@link Paper} signals a discrete physical *flat* object you can
 * pick up, Sphere signals a discrete *volumetric* object placed in
 * space. It's used by the PlayView sound stage to represent instruments
 * as glossy 3D dots, but is reusable anywhere a volumetric token is
 * needed (e.g. waypoint markers, route nodes, future 3D layouts).
 *
 * Recipe (top-left lit, matches the rest of the Viritura design
 * language):
 *
 *   - Base fill driven by `color` (any CSS colour, including
 *     `var(--accent)`).
 *   - Warm bounce rim on the upper-left + inner curvature shadow on
 *     the lower-right (attached `box-shadow` on the sphere body).
 *   - Specular blob on the upper-left + Fresnel rim spec on the
 *     lower-right (two pseudo-element highlights).
 *   - Overlay-blended chrome gradient for gloss.
 *   - A *separate* ground-projected ellipse beneath the sphere — not a
 *     box-shadow — so that lifting the sphere (via the `lift` prop)
 *     widens and softens the shadow without the light source
 *     appearing to move.
 *
 * Lift animation: pass `lift` (0..1). The sphere scales from 78% →
 * 100% and translates upward; the ground shadow widens, softens, and
 * slides toward the light's fall direction (lower-right). All
 * transitions are 160 ms ease-out.
 *
 * See `packages/ui/src/docs/design-language/MaterialTiers.mdx`
 * (Sphere — the volumetric material) for the full design rationale.
 */
import type { CSSProperties } from "react";
import styles from "./Sphere.module.css";

export interface SphereProps {
  /** Base ball colour (any CSS colour value, including `var(--…)`). */
  color: string;
  /** Diameter in CSS pixels. The wrapper sizes to this; the visible
   *  sphere occupies 78% of it at rest (the remainder is the lift
   *  headroom + shadow puddle). */
  size: number;
  /** 0..1 — how far the sphere is lifted off the floor. 0 = resting,
   *  1 = fully lifted. Drives both the scale and the ground-shadow
   *  spread, animated together over 160 ms. */
  lift?: number;
  /** Optional className appended after the sphere base. */
  className?: string;
}

export function Sphere({ color, size, lift = 0, className }: SphereProps) {
  // `--sphere-color` feeds the base fill; `--sphere-lift` is consumed
  // by the sphere transform + the ground-shadow transform/blur in
  // Sphere.module.css.
  const style: CSSProperties = {
    width: size,
    height: size,
    ["--sphere-color" as string]: color,
    ["--sphere-lift" as string]: String(lift),
  };
  const classes = [styles.wrap, className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={classes} style={style}>
      <div className={styles.ground} />
      <div className={styles.shadow}>
        <div className={styles.overlay} />
      </div>
    </div>
  );
}
