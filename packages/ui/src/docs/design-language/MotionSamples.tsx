/**
 * Live motion demos embedded in Motion.mdx.
 *
 * Each demo plays the actual CSS recipe so the docs page is always in
 * sync with the tokens shipped in tokens.css. Edit token values
 * there — these demos pick them up via HMR.
 */
import { useState, type CSSProperties } from "react";
import { Collapsible } from "../../Collapsible/Collapsible";

const SYSTEM_FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const ROW_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  marginTop: 16,
  marginBottom: 24,
  fontFamily: SYSTEM_FONT,
};

const TRACK_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "120px 160px 160px",
  alignItems: "center",
  gap: 12,
  fontSize: 12,
  color: "var(--text)",
};

const TRACK_LANE_STYLE: CSSProperties = {
  position: "relative",
  height: 24,
  borderRadius: "var(--radius-pill)",
  background: "rgba(var(--accent-rgb), 0.10)",
  border: "1px solid rgba(var(--accent-rgb), 0.25)",
  overflow: "hidden",
};

const DOT_BASE: CSSProperties = {
  position: "absolute",
  top: 2,
  width: 18,
  height: 18,
  borderRadius: "var(--radius-pill)",
  background: "rgb(var(--accent-rgb))",
  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
};

/* Inset from each lane edge (px). The dot's left value moves between
   DOT_INSET and `calc(100% - dotWidth - DOT_INSET)` so 100% resolves
   against the lane (the positioned parent), not the dot itself. */
const DOT_INSET = 2;
const DOT_TRAVEL_END = `calc(100% - ${DOT_BASE.width as number}px - ${DOT_INSET}px)`;

const PLAY_BUTTON_STYLE: CSSProperties = {
  padding: "6px 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid rgba(var(--accent-rgb), 0.45)",
  background: "rgba(var(--accent-rgb), 0.12)",
  color: "var(--text)",
  fontFamily: SYSTEM_FONT,
  fontSize: 12,
  cursor: "pointer",
  marginTop: 8,
  alignSelf: "flex-start",
};

const TOKEN_LABEL_STYLE: CSSProperties = {
  fontFamily: MONO_FONT,
  fontSize: 11,
};

const TOKEN_VALUE_STYLE: CSSProperties = {
  fontFamily: MONO_FONT,
  fontSize: 11,
  color: "var(--text-muted)",
};

interface TempoTrack {
  token: string;
  value: string;
}

interface EasingTrack {
  token: string;
  value: string;
  easing: string;
}

const TEMPO_TRACKS: TempoTrack[] = [
  { token: "--motion-semiquaver", value: "16th → 100ms" },
  { token: "--motion-quaver", value: "8th → 200ms" },
  { token: "--motion-crotchet", value: "quarter → 400ms" },
];

const EASING_TRACKS: EasingTrack[] = [
  { token: "--ease-standard", value: "0.4, 0, 0.2, 1", easing: "var(--ease-standard)" },
  { token: "--ease-enter", value: "0, 0, 0.2, 1", easing: "var(--ease-enter)" },
  { token: "--ease-exit", value: "0.4, 0, 1, 1", easing: "var(--ease-exit)" },
];

/**
 * Tempo demo: each click plays a short, finite metronome burst per
 * track. The dot swings wall-to-wall in one 8th note (per the
 * duration token) with `animation-direction: alternate`, run for 4
 * iterations — so each track plays two full quarter notes at its
 * named tempo. The faster tempos finish noticeably before the slower
 * ones, which makes the ratio obvious without subjecting the reader
 * to an endless loop.
 *
 * Re-triggering the burst uses a render `key` so the CSS animation
 * is re-applied from scratch on each click.
 */
const TEMPO_ITERATIONS = 4;

export function MotionTempoDemo() {
  const [playCount, setPlayCount] = useState(0);
  return (
    <>
      <style>{`
        @keyframes motionMetronome {
          from { left: ${DOT_INSET}px; }
          to   { left: ${DOT_TRAVEL_END}; }
        }
        .motionMetronomeDot {
          animation-name: motionMetronome;
          animation-iteration-count: ${TEMPO_ITERATIONS};
          animation-direction: alternate;
          animation-timing-function: var(--ease-standard);
          animation-fill-mode: both;
        }
        @media (prefers-reduced-motion: reduce) {
          .motionMetronomeDot { animation: none; left: 50%; transform: translateX(-50%); }
        }
      `}</style>
      <div style={ROW_STYLE}>
        {TEMPO_TRACKS.map((track) => (
          <div key={track.token} style={TRACK_STYLE}>
            <span style={TOKEN_LABEL_STYLE}>{track.token}</span>
            <div style={TRACK_LANE_STYLE}>
              <div
                key={playCount}
                className={playCount > 0 ? "motionMetronomeDot" : undefined}
                style={{
                  ...DOT_BASE,
                  animationDuration: `var(${track.token})`,
                  left: `${DOT_INSET}px`,
                }}
              />
            </div>
            <span style={TOKEN_VALUE_STYLE}>{track.value}</span>
          </div>
        ))}
        <button type="button" style={PLAY_BUTTON_STYLE} onClick={() => setPlayCount((c) => c + 1)}>
          ▶ Play all tempos
        </button>
      </div>
    </>
  );
}

/**
 * Easing demo: a one-shot traversal at a shared, slow duration (600ms)
 * so the curve shape — not the speed — is what your eye reads. Compact
 * 160px lane keeps the dot in a single saccade so you can see the
 * "settle into place" of --ease-enter vs the "rush out" of --ease-exit
 * without a head turn.
 */
export function MotionEasingDemo() {
  const [playing, setPlaying] = useState(0);
  return (
    <div style={ROW_STYLE}>
      {EASING_TRACKS.map((track) => {
        const dotStyle: CSSProperties = {
          ...DOT_BASE,
          transition: playing ? `left 600ms ${track.easing}` : "none",
          left: playing % 2 === 1 ? DOT_TRAVEL_END : `${DOT_INSET}px`,
        };
        return (
          <div key={track.token} style={TRACK_STYLE}>
            <span style={TOKEN_LABEL_STYLE}>{track.token}</span>
            <div style={TRACK_LANE_STYLE}>
              <div style={dotStyle} />
            </div>
            <span style={TOKEN_VALUE_STYLE}>{track.value}</span>
          </div>
        );
      })}
      <button type="button" style={PLAY_BUTTON_STYLE} onClick={() => setPlaying((p) => p + 1)}>
        ▶ Play all easings (slowed to 600ms)
      </button>
    </div>
  );
}

const COLLAPSIBLE_WRAP_STYLE: CSSProperties = {
  width: 320,
  padding: 4,
  borderRadius: "var(--radius-lg)",
  border: "1px solid rgba(20,20,28,0.08)",
  background: "rgba(255,255,255,0.55)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  marginTop: 16,
  marginBottom: 24,
};

const COLLAPSIBLE_BODY_STYLE: CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  color: "var(--text)",
  fontFamily: SYSTEM_FONT,
};

export function MotionCollapsibleDemo() {
  return (
    <div style={COLLAPSIBLE_WRAP_STYLE}>
      <Collapsible title="Articulations" defaultOpen>
        <div style={COLLAPSIBLE_BODY_STYLE}>Staccato, Accent, Tenuto, Marcato…</div>
      </Collapsible>
      <Collapsible title="Dynamics">
        <div style={COLLAPSIBLE_BODY_STYLE}>pp, p, mp, mf, f, ff…</div>
      </Collapsible>
      <Collapsible title="Ornaments">
        <div style={COLLAPSIBLE_BODY_STYLE}>Trill, Turn, Mordent, Grupetto…</div>
      </Collapsible>
    </div>
  );
}
