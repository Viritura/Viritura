/**
 * Roll mode — Synthesia-style read-only piano-roll visualization.
 *
 * Layout: a single vertical column.
 *   - Top: `PianoRollCanvas` (notes falling toward the keyboard).
 *   - Bottom: `PianoKeyboard` (full-piano horizontal strip).
 *
 * The canvas and the keyboard share a `PianoRollViewport` from
 * `PianoRollProvider` so pitch columns and falling notes stay aligned.
 *
 * Colour scheme is consistent with `PlayView` — each part is mapped to
 * its instrument-family colour via `score/familyColors.ts`. The
 * keyboard strip lights up keys currently sounding under the playhead
 * using each note's part colour.
 *
 * Edits are not wired yet; the projection (`projectToRoll`) currently
 * piggy-backs on `@viritura/midi`'s timeline. When gestures land, the
 * contract for routing them back to MNX is the `EventLocator` on each
 * `PianoRollNote`.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { TransportBar, usePlaybackState } from "@viritura/playback";
import {
  PianoKeyboard,
  PianoRollCanvas,
  PianoRollProvider,
  FpsCounter,
  projectToRoll,
  usePianoRollViewport,
} from "@viritura/piano-roll";
import type { Score } from "@viritura/core";
import { ToolbarPortal } from "../AppShell";
import { partFamilyColor } from "../../score/familyColors";

const ROOT_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  position: "relative",
};

const PANEL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  margin: 14,
  display: "flex",
  flexDirection: "column",
};

const PANEL_BODY_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  position: "relative",
};

const HEADER_ACTIONS_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-muted)",
  textTransform: "none",
  letterSpacing: 0,
  fontWeight: "var(--type-control-weight)",
  fontSize: "var(--type-eyebrow-size)",
};

const EMPTY_OVERLAY_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  pointerEvents: "none",
};

const KEYBOARD_SIZER_STYLE: CSSProperties = { width: "100%", flexShrink: 0 };

// Real-piano white key dimensions: ~23.5mm wide × ~150mm long
// (length-to-width ≈ 6.4). With 52 white keys across the visible
// width, that gives heightPx = (containerWidth / 52) * 6.4. Clamped so
// the keyboard stays readable on narrow viewports and doesn't dominate
// the canvas on ultrawides.
const WHITE_KEY_COUNT = 52;
const WHITE_KEY_ASPECT = 6.4;
const KEYBOARD_MIN_HEIGHT = 80;
const KEYBOARD_MAX_HEIGHT = 180;

interface RollViewProps {
  /** The current score, if available. */
  score?: Score | null;
}

export function RollView({ score }: RollViewProps) {
  return (
    <PianoRollProvider>
      <RollViewInner score={score ?? null} />
    </PianoRollProvider>
  );
}

function RollViewInner({ score }: { score: Score | null }) {
  const notes = useMemo(() => projectToRoll(score), [score]);
  const playback = usePlaybackState();
  const playheadSeconds = playback.playheadPosition?.timeSeconds ?? 0;

  // Per-part colour palette, keyed by partIndex on each PianoRollNote.
  // Same regex sieve as the Play view's spheres.
  const partColors = useMemo(() => {
    const map = new Map<number, string>();
    const parts = score?.parts ?? [];
    parts.forEach((p, i) => map.set(i, partFamilyColor(p.name ?? "")));
    return map;
  }, [score]);

  // Pitches currently sounding under the playhead → the part playing
  // them (first wins on overlap). Used for both the keyboard highlight
  // colour and the lit-key membership test.
  //
  // This recomputes every frame because `playheadSeconds` ticks every
  // frame, but `<PianoKeyboard>` is memoised with a content-equality
  // function on `activeNotes`, so the keyboard skips re-rendering on
  // frames where the lit set is unchanged.
  const activePartByNote = useMemo(() => {
    const m = new Map<number, number>();
    for (const note of notes) {
      if (note.startSeconds <= playheadSeconds && playheadSeconds < note.endSeconds) {
        if (!m.has(note.midiNote)) m.set(note.midiNote, note.partIndex);
      }
    }
    return m;
  }, [notes, playheadSeconds]);

  const activeNotes = useMemo(() => new Set(activePartByNote.keys()), [activePartByNote]);
  const highlightColor = useMemo(
    () => (midi: number) => {
      const partIndex = activePartByNote.get(midi);
      return partIndex !== undefined ? partColors.get(partIndex) : undefined;
    },
    [activePartByNote, partColors],
  );

  const viewport = usePianoRollViewport();

  return (
    <div className="workspace-bg" style={ROOT_STYLE}>
      <ToolbarPortal>
        <TransportBar />
      </ToolbarPortal>
      <div className="workspace-panel workspace-panel--canvas" style={PANEL_STYLE}>
        <div className="workspace-panel__header">
          <span className="workspace-panel__header-label">Piano Roll</span>
          <span className="workspace-panel__header-actions" style={HEADER_ACTIONS_STYLE}>
            {`${viewport.secondsAhead.toFixed(1)}s look-ahead`}
          </span>
        </div>
        <div style={PANEL_BODY_STYLE}>
          <PianoRollCanvas notes={notes} playheadSeconds={playheadSeconds} partColors={partColors} />
          <RollKeyboard activeNotes={activeNotes} highlightColor={highlightColor} />
          {notes.length === 0 && <div style={EMPTY_OVERLAY_STYLE}>No notes to visualize — open or load a score.</div>}
          {import.meta.env.DEV && <FpsCounter />}
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps `<PianoKeyboard>` so it can read the live viewport from the
 * provider that `RollView` establishes, and so the keyboard height
 * tracks the rendered width — preserving a realistic piano key aspect
 * ratio (~1:6.4) instead of letting wide viewports squash the keys.
 */
function RollKeyboard({
  activeNotes,
  highlightColor,
}: {
  activeNotes: ReadonlySet<number>;
  highlightColor: (midi: number) => string | undefined;
}) {
  const viewport = usePianoRollViewport();
  const sizerRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  useEffect(() => {
    const el = sizerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setMeasuredWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const heightPx = useMemo(() => {
    if (measuredWidth === 0) return KEYBOARD_MIN_HEIGHT;
    const ideal = (measuredWidth / WHITE_KEY_COUNT) * WHITE_KEY_ASPECT;
    return Math.round(Math.max(KEYBOARD_MIN_HEIGHT, Math.min(KEYBOARD_MAX_HEIGHT, ideal)));
  }, [measuredWidth]);

  // The SVG uses preserveAspectRatio="none" so widthPx is just internal
  // coordinate space — 1000 gives plenty of precision without bloating
  // the DOM. The real visible aspect ratio is governed by
  // (container width × heightPx) above.
  return (
    <div ref={sizerRef} style={KEYBOARD_SIZER_STYLE}>
      <PianoKeyboard
        widthPx={1000}
        heightPx={heightPx}
        viewport={viewport}
        activeNotes={activeNotes}
        highlightColor={highlightColor}
      />
    </div>
  );
}
