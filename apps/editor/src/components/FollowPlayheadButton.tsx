/**
 * FollowPlayheadButton — floating affordance shown only while the user has
 * scrolled away from a playing/paused playhead (the "detached" state). Clicking
 * it snaps the viewport back and resumes following.
 *
 * It is intentionally a self-contained pill rather than a toolbar control: it
 * appears in-canvas, near where the user is looking, exactly when it is useful.
 */

import type { CSSProperties } from "react";
import { ArrowRightToLine } from "lucide-react";

const WRAP_STYLE: CSSProperties = {
  position: "absolute",
  // Top-center: the bottom edge is occupied by the hover status bar, so the
  // snap-back affordance lives at the top of the canvas instead.
  top: 16,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 6,
  pointerEvents: "none",
};

const PILL_STYLE: CSSProperties = {
  pointerEvents: "auto",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 34,
  padding: "0 14px",
  border: "none",
  borderRadius: 17,
  background: "var(--accent)",
  color: "#fff",
  boxShadow: "var(--elevation-2)",
  cursor: "pointer",
  fontSize: "var(--type-control-size)",
  fontWeight: "var(--type-control-weight)",
};

interface FollowPlayheadButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function FollowPlayheadButton({ visible, onClick }: FollowPlayheadButtonProps) {
  if (!visible) return null;
  return (
    <div style={WRAP_STYLE}>
      {/* eslint-disable-next-line no-restricted-syntax -- bespoke floating canvas CTA pill (rounded accent chrome positioned over the score); no @viritura/ui primitive models this in-canvas affordance. */}
      <button type="button" style={PILL_STYLE} onClick={onClick} aria-label="Follow playhead">
        <ArrowRightToLine size={15} strokeWidth={2} />
        Follow playhead
      </button>
    </div>
  );
}
