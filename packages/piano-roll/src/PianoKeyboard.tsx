/**
 * PianoKeyboard — horizontal 88-key strip at the bottom of the roll.
 *
 * The user reads the roll like they're sitting at a piano: pitch runs
 * left-to-right and notes "fall" onto the keys from above. This is the
 * Synthesia convention.
 *
 * Renders against the same `PianoRollViewport` the canvas uses so the
 * key columns and the falling notes always align. Highlights
 * `activeNotes` (the pitches currently sounding under the playhead)
 * with each part's family colour, mirroring the colours on the
 * waterfall notes above.
 *
 * Pure SVG — sharp on HiDPI, trivially themeable via CSS variables, and
 * no canvas/raster concerns for a static-sized control.
 */

import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { buildKeyLayout, isBlackKey, isWhiteKey } from "./pianoRollGrid";
import type { PianoRollViewport } from "./types";

// Real piano keys read "cream and ebony" regardless of theme — we
// deliberately do NOT theme these. The surrounding chrome (container
// bg, border) handles theme adaptation instead.
const KEY_WHITE_EDGE = "rgba(20, 20, 28, 0.18)";
const KEY_BLACK_EDGE = "rgba(0, 0, 0, 0.6)";

// We render the keyboard as a strict TOP-DOWN view (no perspective).
// At rest, all keys are coplanar and evenly lit. When a key is
// pressed, it pivots around its back (the fulcrum is hidden behind
// the fallboard) and dips DIAGONALLY into the keybed — the front of
// the key drops by the full key-throw while the back stays in place.
//
// Geometry (real-piano dimensions):
//   visible key length (front-back): 150mm
//   key width (left-right):           23.5mm
//   key throw at the front:           10mm
//   tilt angle when pressed:          atan(10/150) ≈ 3.8°
//
// Shadow cast by the (still-up) neighbour key onto the depressed
// surface, assuming overhead light at ~30° from vertical:
//   drop(d)         = d × (10/150)         — vertical gap at dist d
//                                              from the back pivot
//   shadow_w(d)     = drop(d) × tan(30°)
//                   = drop(d) × 0.577
//   shadow_w_front  = 10 × 0.577 ≈ 5.77mm ≈ 24.5% of the 23.5mm key
//   shadow_w_back   = 0
//
// → The side shadow on a depressed key is a TRIANGLE — zero width at
//   the back (top in screen) growing linearly to ~25% of key width at
//   the front (bottom in screen). We approximate the soft edge by
//   filling the triangle with a horizontal gradient that's dark at
//   the outer key edge and transparent toward the centre.
//
// In addition, the recessed surface catches slightly less ambient
// light. The gap widens linearly toward the front, so we add a
// vertical depth-gradient overlay: transparent at the top, darker at
// the bottom. Much subtler than the side shadows.
const SIDE_SHADOW_BOTTOM_FRAC = 0.24; // ~25% of key width at the front
const SIDE_SHADOW_ALPHA = 0.2; // outer-edge opacity of the side shadow gradient
const DEPTH_SHADOW_BOTTOM_ALPHA = 0.12;
// At rest a white key sits ~10mm above the keybed and casts a clear
// shadow onto it. When pressed, the front of the key drops ~10mm —
// closing the gap almost entirely — so the cast shadow on the keybed
// shrinks to roughly a third of its rest intensity.
const KEY_CAST_SHADOW_ALPHA_REST = 0.55;
const KEY_CAST_SHADOW_ALPHA_PRESSED = 0.18;
// Black-key geometry. Narrower at the top, wider at the bottom — this
// is the perspective you get when looking down at a piano with a
// slight forward tilt. Real black keys are rectangular top-down, but
// a static plan view loses all sense of depth; the trapezoid sells the
// 3D form without needing actual 3D rendering.
const BLACK_KEY_TAPER_FRAC = 0.08; // each side narrows by this fraction of width at the top
const BLACK_KEY_CORNER_R = 1.5;

const CONTAINER_STYLE: CSSProperties = {
  position: "relative",
  width: "100%",
  background: "var(--surface)",
  // Top hairline shadow inside the SVG handles the cast shadow from
  // the (implied) fallboard — no need for an external material
  // box-shadow.
  borderTop: "1px solid var(--border)",
  overflow: "hidden",
  flexShrink: 0,
};

const SVG_STYLE: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
};

// Inline <style> the SVG carries with it so key fills animate at
// the design-system's --motion-semiquaver / --ease-standard rhythm.
const KEY_TRANSITION_CSS = `
  .viritura-roll-key {
    transition:
      fill var(--motion-semiquaver, 100ms) var(--ease-standard, cubic-bezier(0.4, 0, 0.2, 1));
  }
`;

/** Trapezoidal black-key outline with rounded bottom corners. */
function blackKeyPath(x: number, w: number, h: number, taper: number, r: number): string {
  return [
    `M ${x + taper} 0`,
    `L ${x + w - taper} 0`,
    `L ${x + w} ${h - r}`,
    `Q ${x + w} ${h} ${x + w - r} ${h}`,
    `L ${x + r} ${h}`,
    `Q ${x} ${h} ${x} ${h - r}`,
    `Z`,
  ].join(" ");
}

/**
 * Just the bottom "front-face" portion of the black-key trapezoid.
 * Used as an overlay so lit keys still show the dark front lip on top
 * of the part-coloured highlight, preserving the 3D shape.
 */
function blackKeyFrontPath(x: number, w: number, h: number, taper: number, r: number, lipH: number): string {
  const lipTopY = h - lipH;
  // The trapezoid widens going down; figure out the x-inset at the lip's top edge.
  const lipTopInset = taper * (lipTopY / h);
  return [
    `M ${x + lipTopInset} ${lipTopY}`,
    `L ${x + w - lipTopInset} ${lipTopY}`,
    `L ${x + w} ${h - r}`,
    `Q ${x + w} ${h} ${x + w - r} ${h}`,
    `L ${x + r} ${h}`,
    `Q ${x} ${h} ${x} ${h - r}`,
    `Z`,
  ].join(" ");
}

interface WhiteKeyArgs {
  midi: number;
  bounds: { x: number; width: number };
  heightPx: number;
  whiteTopShadowHeight: number;
  whiteFrontEdgePx: number;
  lit: boolean;
  litFill: string | null;
}

function renderWhiteKey(args: WhiteKeyArgs): ReactNode {
  const { midi, bounds, heightPx, whiteTopShadowHeight, whiteFrontEdgePx, lit, litFill } = args;
  // Height of the sharp "hit" stripe at the top edge — the visual
  // signal that the falling note just landed here.
  const hitStripePx = Math.max(2, Math.round(heightPx * 0.025));
  return (
    <g key={`w-${midi}`}>
      {/* Body — always its natural cream so the skeuomorphic shading
          keeps reading regardless of part colour. */}
      <rect
        className="viritura-roll-key"
        x={bounds.x}
        y={0}
        width={bounds.width}
        height={heightPx}
        fill="url(#viritura-white-key)"
        stroke={KEY_WHITE_EDGE}
        strokeWidth={0.5}
      />
      {/* Colour wash: the part colour bleeds into the top of the key
          and fades out by mid-height. */}
      {lit && litFill && (
        <rect
          x={bounds.x}
          y={0}
          width={bounds.width}
          height={heightPx}
          fill={litFill}
          mask="url(#viritura-press-wash-mask)"
          opacity={0.7}
          pointerEvents="none"
        />
      )}
      {/* Sharp top hit-stripe — the unambiguous "this key is on" signal. */}
      {lit && litFill && (
        <rect x={bounds.x} y={0} width={bounds.width} height={hitStripePx} fill={litFill} pointerEvents="none" />
      )}
      {/* Side shadows cast by the (still-up) neighbouring keys onto
          the pressed surface. Triangles — zero width at the back
          pivot, growing to ~25% of key width at the front. The
          gradient inside softens the inner edge. See the geometry
          comment at the top of this file for the derivation. */}
      {lit && (
        <>
          <path
            d={`M ${bounds.x} 0 L ${bounds.x} ${heightPx} L ${bounds.x + bounds.width * SIDE_SHADOW_BOTTOM_FRAC} ${heightPx} Z`}
            fill="url(#viritura-press-side-shadow-left)"
            pointerEvents="none"
          />
          <path
            d={`M ${bounds.x + bounds.width} 0 L ${bounds.x + bounds.width} ${heightPx} L ${bounds.x + bounds.width - bounds.width * SIDE_SHADOW_BOTTOM_FRAC} ${heightPx} Z`}
            fill="url(#viritura-press-side-shadow-right)"
            pointerEvents="none"
          />
          {/* Depth shadow — the recessed surface catches less ambient
              light, with the gap widest at the front. Vertical
              gradient: invisible at the back, gentle dim at the front. */}
          <rect
            x={bounds.x}
            y={0}
            width={bounds.width}
            height={heightPx}
            fill="url(#viritura-press-depth-shadow)"
            pointerEvents="none"
          />
        </>
      )}
      {/* Fallboard cast shadow at the back of the key. */}
      <rect
        x={bounds.x}
        y={0}
        width={bounds.width}
        height={whiteTopShadowHeight}
        fill="url(#viritura-white-top-shadow)"
        opacity={lit ? 1.25 : 1}
        pointerEvents="none"
      />
      {/* Front-edge hairline — the curved-down lip of a real key. */}
      <rect
        x={bounds.x}
        y={heightPx - whiteFrontEdgePx}
        width={bounds.width}
        height={whiteFrontEdgePx}
        fill="rgba(60, 50, 35, 0.35)"
        pointerEvents="none"
      />
    </g>
  );
}

interface BlackKeyArgs {
  midi: number;
  bounds: { x: number; width: number };
  blackHeight: number;
  blackLipHeight: number;
  lit: boolean;
  litFill: string | null;
}

function renderBlackKey(args: BlackKeyArgs): ReactNode {
  const { midi, bounds, blackHeight, blackLipHeight, lit, litFill } = args;
  const taper = bounds.width * BLACK_KEY_TAPER_FRAC;
  const bodyPath = blackKeyPath(bounds.x, bounds.width, blackHeight, taper, BLACK_KEY_CORNER_R);
  const frontPath = blackKeyFrontPath(bounds.x, bounds.width, blackHeight, taper, BLACK_KEY_CORNER_R, blackLipHeight);
  return (
    <g key={`b-${midi}`}>
      {/* Body — natural ebony, trapezoidal so the chamfer reads. */}
      <path
        className="viritura-roll-key"
        d={bodyPath}
        fill="url(#viritura-black-key)"
        stroke={KEY_BLACK_EDGE}
        strokeWidth={0.5}
      />
      {/* Colour wash: part colour bleeds in from the top edge and
          fades by mid-key. */}
      {lit && litFill && (
        <path d={bodyPath} fill={litFill} mask="url(#viritura-press-wash-mask)" opacity={0.85} pointerEvents="none" />
      )}
      {/* Sharp top hit-stripe. */}
      {lit && litFill && (
        <rect
          x={bounds.x + taper}
          y={0}
          width={Math.max(0, bounds.width - taper * 2)}
          height={Math.max(2, Math.round(blackHeight * 0.04))}
          fill={litFill}
          pointerEvents="none"
        />
      )}
      {/* Inset shadow + depth dim. The trapezoidal shape means the
          side shadows have to follow the diagonal trapezoid edges —
          apex at the top corner (zero shadow at the back pivot), base
          extending from the bottom corner (which sits OUTSIDE the
          top-left corner because the trapezoid widens going down)
          inward by ~24% of the bottom-width. */}
      {lit && (
        <>
          <path
            d={`M ${bounds.x + taper} 0 L ${bounds.x} ${blackHeight} L ${bounds.x + bounds.width * SIDE_SHADOW_BOTTOM_FRAC} ${blackHeight} Z`}
            fill="url(#viritura-press-side-shadow-left)"
            pointerEvents="none"
          />
          <path
            d={`M ${bounds.x + bounds.width - taper} 0 L ${bounds.x + bounds.width} ${blackHeight} L ${bounds.x + bounds.width - bounds.width * SIDE_SHADOW_BOTTOM_FRAC} ${blackHeight} Z`}
            fill="url(#viritura-press-side-shadow-right)"
            pointerEvents="none"
          />
          {/* Depth shadow clipped to the trapezoid — darker at the
              front (bottom) where the recess is deepest. */}
          <path d={bodyPath} fill="url(#viritura-press-depth-shadow)" pointerEvents="none" />
        </>
      )}
      {/* Top-edge shadow band painted over the lit colour. */}
      {lit && (
        <rect
          x={bounds.x + taper}
          y={0}
          width={Math.max(0, bounds.width - taper * 2)}
          height={Math.max(2, Math.round(blackHeight * 0.06))}
          fill="url(#viritura-black-top-shadow)"
          pointerEvents="none"
        />
      )}
      {/* Front-face overlay (the dark lip at the bottom of the body). */}
      <path d={frontPath} fill="url(#viritura-black-front)" opacity={lit ? 0.85 : 1} pointerEvents="none" />
      {/* Top-edge chamfer highlight — suppressed when pressed (the
         key is now in shadow). */}
      {!lit && (
        <path
          d={`M ${bounds.x + taper + 0.5} 0.5 L ${bounds.x + bounds.width - taper - 0.5} 0.5`}
          stroke="rgba(255, 255, 255, 0.18)"
          strokeWidth={0.75}
          fill="none"
          pointerEvents="none"
        />
      )}
    </g>
  );
}

interface OctaveLabelArgs {
  midi: number;
  bounds: { x: number; width: number };
  widthPx: number;
  whiteFrontEdgePx: number;
  keybedPx: number;
}

function renderOctaveLabel({ midi, bounds, widthPx, whiteFrontEdgePx, keybedPx }: OctaveLabelArgs): ReactNode | null {
  const pc = ((midi % 12) + 12) % 12;
  if (pc !== 0 || bounds.width < 8) return null;
  const octave = Math.floor(midi / 12) - 1;
  // HTML overlay (not SVG <text>) so the label isn't subject to the
  // SVG's preserveAspectRatio="none" non-uniform scaling. Positioned
  // in percentages relative to widthPx (which matches the container's
  // measured width) so it tracks exactly with the underlying key.
  const leftPct = ((bounds.x + bounds.width / 2) / widthPx) * 100;
  const labelStyle: CSSProperties = {
    position: "absolute",
    left: `${leftPct}%`,
    // Sit just above the keybed band, on the front of the white key.
    bottom: keybedPx + whiteFrontEdgePx + 3,
    transform: "translateX(-50%)",
    fontSize: 10,
    fontWeight: 600,
    color: "rgba(20, 20, 28, 0.55)",
    pointerEvents: "none",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: 0,
  };
  return (
    <span key={`label-${midi}`} style={labelStyle}>
      C{octave}
    </span>
  );
}

interface PianoKeyboardProps {
  /** Width of the parent in pixels (matches the roll canvas). */
  widthPx: number;
  /** Height of the keyboard strip in pixels. */
  heightPx: number;
  /** Viewport — shared with the roll canvas. */
  viewport: PianoRollViewport;
  /** Currently sounding MIDI notes (lit up). */
  activeNotes?: ReadonlySet<number>;
  /**
   * Optional override colour for lit keys. Pass a callback to colour
   * each active key by part family; falls back to `--accent` otherwise.
   */
  highlightColor?: (midi: number) => string | undefined;
}

function PianoKeyboardImpl({ widthPx, heightPx, viewport, activeNotes, highlightColor }: PianoKeyboardProps) {
  const containerStyle = useMemo<CSSProperties>(() => ({ ...CONTAINER_STYLE, height: heightPx }), [heightPx]);

  // Precompute key positions; rebuild only when inputs change.
  const layout = useMemo(() => buildKeyLayout(viewport, widthPx), [viewport, widthPx]);

  // Two passes: white keys first (full height), then black keys on top (shorter, narrower, darker).
  const whiteRects: ReactNode[] = [];
  const blackRects: ReactNode[] = [];
  const castShadows: ReactNode[] = [];
  const labels: ReactNode[] = [];

  // Reserve a hairline strip at the bottom of the SVG as the
  // "keybed" — the recessed cabinet surface behind the keys. Just a
  // visual frame so the keyboard sits in its cabinet rather than
  // floating against the workspace background.
  const keybedPx = Math.max(4, Math.round(heightPx * 0.04));
  const restingKeyHeight = heightPx - keybedPx;
  const blackHeight = restingKeyHeight * 0.62;
  // Top fallboard-shadow band on white keys — the soft shadow cast by
  // the cabinet's edge onto the back of the keys.
  const whiteTopShadowHeight = Math.max(2, Math.round(restingKeyHeight * 0.04));
  // Front-edge dark line. Real keys curve down at the lip; we sell
  // that with a single dark hairline rather than a heavy bevel band
  // (which read as a UI artifact, not depth).
  const whiteFrontEdgePx = Math.max(1, Math.round(restingKeyHeight * 0.012));
  // Black-key front-face lip height (the visible dark "front" of the key).
  const blackLipHeight = Math.max(2, Math.round(blackHeight * 0.18));

  for (let midi = viewport.minMidi; midi <= viewport.maxMidi; midi++) {
    const bounds = layout.get(midi);
    if (!bounds) continue;
    if (!isWhiteKey(midi)) continue;
    const lit = activeNotes?.has(midi) ?? false;
    const litFill = lit ? (highlightColor?.(midi) ?? "var(--accent)") : null;
    whiteRects.push(
      renderWhiteKey({
        midi,
        bounds,
        heightPx: restingKeyHeight,
        whiteTopShadowHeight,
        whiteFrontEdgePx,
        lit,
        litFill,
      }),
    );
    castShadows.push(
      <rect
        key={`cast-${midi}`}
        x={bounds.x}
        y={restingKeyHeight}
        width={bounds.width}
        height={keybedPx}
        fill="url(#viritura-key-cast-shadow)"
        opacity={lit ? KEY_CAST_SHADOW_ALPHA_PRESSED : KEY_CAST_SHADOW_ALPHA_REST}
        pointerEvents="none"
      />,
    );
    const label = renderOctaveLabel({ midi, bounds, widthPx, whiteFrontEdgePx, keybedPx });
    if (label) labels.push(label);
  }

  // Second pass for black keys so they paint on top of the white-key edges.
  for (let midi = viewport.minMidi; midi <= viewport.maxMidi; midi++) {
    if (!isBlackKey(midi)) continue;
    const bounds = layout.get(midi);
    if (!bounds) continue;
    const lit = activeNotes?.has(midi) ?? false;
    const litFill = lit ? (highlightColor?.(midi) ?? "var(--accent)") : null;
    blackRects.push(
      renderBlackKey({
        midi,
        bounds,
        blackHeight,
        blackLipHeight,
        lit,
        litFill,
      }),
    );
  }

  return (
    <div style={containerStyle}>
      <svg style={SVG_STYLE} viewBox={`0 0 ${widthPx} ${heightPx}`} preserveAspectRatio="none">
        <defs>
          {/* White key body: subtly cream, very gentle top-to-bottom
              shift. Heavy gradients on a static plan-view read as
              gradient artifacts, not depth. */}
          <linearGradient id="viritura-white-key" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fbf8f1" />
            <stop offset="1" stopColor="#f1ece0" />
          </linearGradient>
          {/* Fallboard cast shadow on the back of the white keys.
              Darkest at the top edge, fades to nothing across ~4% of
              the key. */}
          <linearGradient id="viritura-white-top-shadow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(20, 20, 28, 0.45)" />
            <stop offset="1" stopColor="rgba(20, 20, 28, 0)" />
          </linearGradient>
          {/* Same idea for black keys — darkens the top of the lit
              colour stripe so it visually separates from the falling
              note above the keyboard border. */}
          <linearGradient id="viritura-black-top-shadow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(0, 0, 0, 0.55)" />
            <stop offset="1" stopColor="rgba(0, 0, 0, 0)" />
          </linearGradient>
          {/* Press-wash mask: white at top → transparent by mid-key.
              Applied to a solid-fill rect/path of the part colour so
              the colour reads as a bleed-in from where the falling
              note hit, leaving the bottom of the key in its natural
              colour. Uses objectBoundingBox so the same mask fits any
              key shape. */}
          <linearGradient id="viritura-press-wash-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="white" stopOpacity="1" />
            <stop offset="0.45" stopColor="white" stopOpacity="0.25" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id="viritura-press-wash-mask" maskContentUnits="objectBoundingBox">
            <rect x="0" y="0" width="1" height="1" fill="url(#viritura-press-wash-grad)" />
          </mask>
          {/* Black-key body: top catches a touch of light, body is
              warm-dark, with a sharp ridge transition right before the
              front lip (two adjacent stops at the same offset). Reads
              as a chamfered top face meeting a vertical front face. */}
          <linearGradient id="viritura-black-key" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a3a42" />
            <stop offset="0.06" stopColor="#26262c" />
            <stop offset="0.75" stopColor="#1c1c22" />
            <stop offset="0.82" stopColor="#15151a" />
          </linearGradient>
          {/* Front face of the black key — visibly darker than the top
              face, with the brightest pixel right at the ridge. */}
          <linearGradient id="viritura-black-front" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a2a30" />
            <stop offset="0.15" stopColor="#0e0e12" />
            <stop offset="1" stopColor="#050507" />
          </linearGradient>
          {/* Side shadows for a pressed key. Painted onto a triangle
              whose vertices encode the geometry (zero shadow at the
              back pivot, max shadow at the front). The gradient
              softens the inner edge of each triangle. Uses
              objectBoundingBox so the same gradient fits any triangle
              size. */}
          <linearGradient
            id="viritura-press-side-shadow-left"
            gradientUnits="objectBoundingBox"
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset="0" stopColor={`rgba(0, 0, 0, ${SIDE_SHADOW_ALPHA})`} />
            <stop offset="1" stopColor="rgba(0, 0, 0, 0)" />
          </linearGradient>
          <linearGradient
            id="viritura-press-side-shadow-right"
            gradientUnits="objectBoundingBox"
            x1="1"
            y1="0"
            x2="0"
            y2="0"
          >
            <stop offset="0" stopColor={`rgba(0, 0, 0, ${SIDE_SHADOW_ALPHA})`} />
            <stop offset="1" stopColor="rgba(0, 0, 0, 0)" />
          </linearGradient>
          {/* Depth shadow — vertical gradient encoding the pressed
              surface being recessed deeper at the front than at the
              back. Transparent at the top (back, still at pivot
              level), darker at the bottom (front, fully dipped). */}
          <linearGradient id="viritura-press-depth-shadow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(0, 0, 0, 0)" />
            <stop offset="1" stopColor={`rgba(0, 0, 0, ${DEPTH_SHADOW_BOTTOM_ALPHA})`} />
          </linearGradient>
          {/* Per-key cast shadow projected onto the keybed by a raised
              white key. Vertical gradient — darkest right at the key's
              front edge, fading into the keybed below. The element's
              opacity is modulated per-key (rest vs pressed) since a
              pressed key sits much closer to the keybed and casts a
              much fainter shadow. */}
          <linearGradient id="viritura-key-cast-shadow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(0, 0, 0, 0.7)" />
            <stop offset="1" stopColor="rgba(0, 0, 0, 0)" />
          </linearGradient>
          {/* Keybed: hairline recessed cabinet strip behind the keys.
              Painted very lightly because the per-key cast shadows
              above carry most of the visual depth signal — this just
              keeps the keyboard from floating against the workspace. */}
          <linearGradient id="viritura-keybed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(20, 16, 10, 0.18)" />
            <stop offset="1" stopColor="rgba(20, 16, 10, 0.08)" />
          </linearGradient>
        </defs>
        <style>{KEY_TRANSITION_CSS}</style>
        {/* Keybed band painted FIRST so the keys layer on top.
            Resting keys cover most of the SVG; the keybed shows below
            them as a darker recessed cabinet surface. */}
        <rect x={0} y={restingKeyHeight} width={widthPx} height={keybedPx} fill="url(#viritura-keybed)" />
        {/* Per-key cast shadows on the keybed — each white key casts a
            shadow onto the keybed strip; pressed keys cast much
            fainter shadows because they've dropped toward the keybed.
            Painted between the keybed and the keys themselves so the
            shadows visually anchor each key to the cabinet. */}
        {castShadows}
        {whiteRects}
        {blackRects}
      </svg>
      {labels}
    </div>
  );
}

// Memoised so the keyboard only re-renders when one of its props
// actually changes meaningfully. The transport ticks `playheadSeconds`
// every frame in the parent, which makes `activeNotes` /
// `highlightColor` get fresh identities every frame even when the lit
// set is unchanged. We compare `activeNotes` by content so those
// no-op frames skip the whole 88-key SVG reconciliation. We treat the
// `highlightColor` callback as redundant when `activeNotes` content is
// identical — the parent derives both from the same `(playhead, notes,
// partColors)` triple, so equal lit sets ⇒ equal colours.
function arePropsEqual(prev: PianoKeyboardProps, next: PianoKeyboardProps): boolean {
  if (prev.widthPx !== next.widthPx) return false;
  if (prev.heightPx !== next.heightPx) return false;
  if (prev.viewport !== next.viewport) return false;
  const a = prev.activeNotes;
  const b = next.activeNotes;
  if (a !== b) {
    if (!a || !b) return false;
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
  }
  return true;
}

export const PianoKeyboard = memo(PianoKeyboardImpl, arePropsEqual);
