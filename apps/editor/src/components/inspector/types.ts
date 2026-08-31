import type { CSSProperties } from "react";
import type { Score } from "@viritura/core";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import type { InspectorSection } from "./notationInspectorMeta";

/** Common props shared by all inspector section sub-components. */
export interface InspectorSectionProps {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (score: Score) => void;
  focusedSection: InspectorSection | null;
  sectionRef: React.RefObject<HTMLFieldSetElement | null>;
}

// ═══════════════════════════════════════════
// Shared inline styles used across sections
//
// Inspector lives inside a `.workspace-panel` glass surface (see
// `PublishView.module.css .panel`). Sections are therefore flat groups
// separated by a single hairline divider with PublishView-style
// uppercase mini-labels — NOT nested raised cards.
// ═══════════════════════════════════════════

export const sectionStyle: CSSProperties = {
  margin: 0,
  padding: "14px 0 4px",
  border: "none",
  borderTop: "1px solid var(--border-hairline)",
  borderRadius: 0,
  background: "transparent",
  boxShadow: "none",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

export const legendStyle: CSSProperties = {
  fontSize: "0.7rem",
  color: "var(--text-muted)",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: 0,
  marginBottom: "4px",
  float: "left" as const,
  width: "100%",
};

export const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.75rem",
  color: "var(--text)",
};

// Focused-section indicator — subtle left accent stripe + soft tint.
const focusedSectionStyle: CSSProperties = {
  borderLeft: "2px solid rgba(var(--accent-rgb, 33, 94, 78), 0.7)",
  paddingLeft: "10px",
  marginLeft: "-12px",
  background:
    "linear-gradient(90deg, rgba(var(--accent-rgb, 33, 94, 78), 0.07) 0%, rgba(var(--accent-rgb, 33, 94, 78), 0) 60%)",
};

/** Build a fieldset style by merging the base section style with the
 *  focused-section accent when this section is the focused one. Used
 *  by every inspector section to keep the call-site free of object
 *  literals (banned by the no-inline-styles rule). */
export function mergeFocusedSectionStyle(section: string, focusedSection: string | null | undefined): CSSProperties {
  return focusedSection === section ? Object.assign({}, sectionStyle, focusedSectionStyle) : sectionStyle;
}

export const errorStyle: CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--error)",
};
