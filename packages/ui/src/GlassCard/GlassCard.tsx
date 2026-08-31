/**
 * GlassCard — translucent rounded card used throughout the editor for
 * grouped content sitting on top of the workspace glass surface.
 *
 *   ╭────────────────────────────────────────╮
 *   │ Optional title                         │
 *   │ Children …                             │
 *   ╰────────────────────────────────────────╯
 *
 * Visual language: 12px radius, hairline border (rgba 20,20,28,0.08),
 * 35 % white fill. Used for inspector sub-sections (Engrave slur properties,
 * Notation Inspector groups) and for opt-in cards (Review's "Set up version
 * history" card). The containing panel owns any live backdrop blur.
 *
 * For full-panel headers/scroll bodies, use PanelHeader instead.
 */
import type { ReactNode } from "react";
import styles from "./GlassCard.module.css";

export interface GlassCardProps {
  /** Optional small title shown at the top of the card. */
  title?: ReactNode;
  /** Card body. */
  children: ReactNode;
  /** Padding density. `cozy` (default) ≈ 14px, `compact` ≈ 10px. */
  padding?: "cozy" | "compact";
  /** Additional className for the outer container. */
  className?: string;
}

export function GlassCard({ title, children, padding = "cozy", className }: GlassCardProps) {
  return (
    <div className={`${styles.card} ${padding === "compact" ? styles.compact : ""} ${className ?? ""}`}>
      {title && <div className={styles.title}>{title}</div>}
      {children}
    </div>
  );
}
