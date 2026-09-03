/**
 * Live material-tier swatches embedded in MaterialTiers.mdx.
 *
 * Each demo renders the actual CSS recipe for a tier, sitting on a
 * miniature workspace mesh so glass surfaces have something to refract.
 * Edit a tier's recipe here — the MDX docs page picks it up via HMR.
 */
import type { CSSProperties, ReactNode } from "react";
import { PaletteButton } from "../../PaletteButton";

const STAGE_BG =
  "radial-gradient(circle at 12% 18%, rgba(58,142,122,0.38), transparent 55%)," +
  "radial-gradient(circle at 88% 82%, rgba(244,200,120,0.32), transparent 55%)," +
  "radial-gradient(circle at 70% 12%, rgba(95,170,220,0.32), transparent 50%)," +
  "radial-gradient(circle at 22% 90%, rgba(178,140,220,0.30), transparent 55%)," +
  "linear-gradient(180deg, #e8ecef 0%, #dde2e7 100%)";

const SYSTEM_FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const stageStyle: CSSProperties = {
  position: "relative",
  background: STAGE_BG,
  borderRadius: "var(--radius-lg, 14px)",
  padding: "32px",
  minHeight: "180px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  // Faint border so the stage reads as a bounded area in both themes.
  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
  // Storybook docs context overrides body font — force the app's system
  // stack so chrome samples match what the editor actually renders.
  fontFamily: SYSTEM_FONT,
};

const captionStyle: CSSProperties = {
  position: "absolute",
  bottom: 8,
  left: 12,
  fontSize: 11,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "rgba(0,0,0,0.55)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};

function Stage({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div style={stageStyle}>
      {children}
      <span style={captionStyle}>{caption}</span>
    </div>
  );
}

const cardLabelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text, #1c1c24)",
  margin: 0,
};

const cardSubStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted, rgba(28,28,36,0.65))",
  margin: "4px 0 0",
};

const TIER0_TEXT_STYLE: CSSProperties = {
  color: "rgba(0,0,0,0.55)",
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};

// ─── Tier 0 — Workspace ────────────────────────────────────────────────
export function Tier0Sample() {
  return (
    <Stage caption="Tier 0 · Workspace">
      <div style={TIER0_TEXT_STYLE}>(no surface — this *is* the world)</div>
    </Stage>
  );
}

const TIER1_CARD_STYLE: CSSProperties = {
  width: 220,
  padding: "16px 18px",
  background: "color-mix(in srgb, var(--surface, #ffffff) 65%, transparent)",
  backdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "var(--radius-md, 10px)",
  boxShadow: "var(--elevation-1, 0 1px 2px rgba(0,0,0,0.08))",
};

// ─── Tier 1 — Glass panel ──────────────────────────────────────────────
export function Tier1Sample() {
  return (
    <Stage caption="Tier 1 · Glass (panel)">
      <div style={TIER1_CARD_STYLE}>
        <p style={cardLabelStyle}>Mixer</p>
        <p style={cardSubStyle}>12 instruments · 3 buses</p>
      </div>
    </Stage>
  );
}

// Mirrors apps/editor/src/components/MenuBar.module.css: 13px,
// inherits system font, padding 4px 10px on triggers, no shadow, no
// backdrop-filter, no lit rim.
const TIER2_TRIGGER_STYLE: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "var(--radius-md, 6px)",
  color: "var(--text, #1c1c24)",
  cursor: "default",
};

const TIER2_BAR_STYLE: CSSProperties = {
  width: "100%",
  maxWidth: 420,
  height: 36,
  display: "flex",
  alignItems: "center",
  gap: 2,
  padding: "0 6px",
  background: "var(--surface, #ffffff)",
  borderRadius: "var(--radius-sm, 4px)",
  fontFamily: SYSTEM_FONT,
  fontSize: 13,
  lineHeight: "22px",
  boxShadow: "inset 0 0 0 1px var(--border, rgba(0,0,0,0.08))",
};

const TIER2_TAIL_STYLE: CSSProperties = {
  marginLeft: "auto",
  paddingRight: 4,
  fontSize: 11,
  opacity: 0.55,
  color: "var(--text-muted, rgba(28,28,36,0.65))",
};

// ─── Tier 2 — Chrome ───────────────────────────────────────────────────
export function Tier2Sample() {
  return (
    <Stage caption="Tier 2 · Chrome (edge-pinned)">
      <div style={TIER2_BAR_STYLE}>
        <span style={TIER2_TRIGGER_STYLE}>File</span>
        <span style={TIER2_TRIGGER_STYLE}>Edit</span>
        <span style={TIER2_TRIGGER_STYLE}>View</span>
        <span style={TIER2_TRIGGER_STYLE}>Score</span>
        <span style={TIER2_TAIL_STYLE}>flat · opaque</span>
      </div>
    </Stage>
  );
}

const TIER3_POPOVER_STYLE: CSSProperties = {
  padding: "10px 12px",
  background: "color-mix(in srgb, var(--surface-raised, #ffffff) 92%, transparent)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "var(--radius-sm, 6px)",
  boxShadow: "var(--elevation-2, 0 6px 18px rgba(0,0,0,0.18))",
  color: "var(--text, #1c1c24)",
  fontSize: 12,
  maxWidth: 240,
  lineHeight: 1.4,
};

const KBD_STYLE: CSSProperties = { fontFamily: "inherit", fontWeight: 600 };

// ─── Tier 3 — Floating ─────────────────────────────────────────────────
export function Tier3Sample() {
  return (
    <Stage caption="Tier 3 · Floating (popover/tooltip)">
      <div style={TIER3_POPOVER_STYLE}>
        Hold <kbd style={KBD_STYLE}>⌥</kbd> to drag a duplicate.
      </div>
    </Stage>
  );
}

// Button geometry mirrors packages/ui/src/Dialog/Dialog.module.css
// .btnBase / .btnCancel / .btnPrimary: padding 0.5rem 1rem, radius-md,
// font-size 0.88rem, weight 500 (cancel) / 600 (primary).
const TIER4_BTN_BASE: CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: "var(--radius-md, 6px)",
  fontSize: "0.88rem",
  fontFamily: "inherit",
  fontWeight: 500,
  cursor: "pointer",
};

const TIER4_OVERLAY_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(20, 20, 28, 0.55)",
};

const TIER4_DIALOG_STYLE: CSSProperties = {
  position: "relative",
  width: 300,
  padding: "1.25rem 1.25rem 1rem",
  background: "var(--surface-raised, #ffffff)",
  border: "1px solid var(--border, rgba(0,0,0,0.08))",
  borderRadius: "var(--radius-xl, 12px)",
  boxShadow: "var(--elevation-3, 0 20px 50px rgba(0,0,0,0.3))",
  color: "var(--text, #1c1c24)",
};

const TIER4_TITLE_STYLE: CSSProperties = { margin: 0, fontSize: "1.05rem", fontWeight: 600 };
const TIER4_SUB_STYLE: CSSProperties = { ...cardSubStyle, marginTop: 8 };
const TIER4_BTN_ROW_STYLE: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  justifyContent: "flex-end",
  marginTop: 16,
};
const TIER4_CANCEL_STYLE: CSSProperties = {
  ...TIER4_BTN_BASE,
  border: "1px solid var(--border, rgba(0,0,0,0.12))",
  background: "var(--surface, #ffffff)",
  color: "var(--text, #1c1c24)",
};
const TIER4_PRIMARY_STYLE: CSSProperties = {
  ...TIER4_BTN_BASE,
  fontWeight: 600,
  border: "1px solid rgb(var(--accent-rgb, 47 125 106))",
  background: "rgb(var(--accent-rgb, 47 125 106))",
  color: "#fff",
  boxShadow: "0 1px 2px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.18)",
};

// ─── Tier 4 — Modal ────────────────────────────────────────────────────
export function Tier4Sample() {
  return (
    <Stage caption="Tier 4 · Modal (dialog)">
      {/* Production blurs the app root; this miniature sample only needs the dim layer. */}
      <div style={TIER4_OVERLAY_STYLE} />
      <div style={TIER4_DIALOG_STYLE}>
        <p style={TIER4_TITLE_STYLE}>Delete this part?</p>
        <p style={TIER4_SUB_STYLE}>The “Violin II” part will be removed. This cannot be undone.</p>
        <div style={TIER4_BTN_ROW_STYLE}>
          <button type="button" style={TIER4_CANCEL_STYLE}>
            Cancel
          </button>
          <button type="button" style={TIER4_PRIMARY_STYLE}>
            Delete
          </button>
        </div>
      </div>
    </Stage>
  );
}

const COMPARE_GRID_STYLE: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };
const COMPARE_BG_GLASS_STYLE: CSSProperties = {
  position: "absolute",
  inset: 24,
  background: "color-mix(in srgb, var(--surface, #ffffff) 65%, transparent)",
  backdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "var(--radius-md, 10px)",
};
const COMPARE_FG_GLASS_STYLE: CSSProperties = {
  position: "relative",
  padding: 14,
  background: "color-mix(in srgb, var(--surface, #ffffff) 55%, transparent)",
  backdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "var(--radius-md, 10px)",
  fontSize: 12,
  color: "var(--text, #1c1c24)",
};
const COMPARE_DIM_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(20,20,28,0.55)",
  backdropFilter: "blur(8px) saturate(120%)",
};
const COMPARE_OPAQUE_STYLE: CSSProperties = {
  position: "relative",
  padding: 14,
  background: "var(--surface-raised, #ffffff)",
  border: "1px solid var(--border, rgba(0,0,0,0.08))",
  borderRadius: "var(--radius-md, 10px)",
  boxShadow: "var(--elevation-3, 0 20px 50px rgba(0,0,0,0.3))",
  fontSize: 12,
  color: "var(--text, #1c1c24)",
};

// ─── Side-by-side: Glass-on-glass vs. opaque-on-dim ────────────────────
export function GlassOnGlassComparison() {
  return (
    <div style={COMPARE_GRID_STYLE}>
      <Stage caption="Glass on glass — mush">
        {/* Background panel: Tier-1 glass */}
        <div style={COMPARE_BG_GLASS_STYLE} />
        {/* Foreground glass dialog */}
        <div style={COMPARE_FG_GLASS_STYLE}>Edges fight. Backdrop blurs twice.</div>
      </Stage>

      <Stage caption="Opaque on dim — clean">
        <div style={COMPARE_DIM_STYLE} />
        <div style={COMPARE_OPAQUE_STYLE}>One clear edge. Workspace fades politely.</div>
      </Stage>
    </div>
  );
}

// ─── Paper — physical object material on top of glass ─────────────────
//
// Paper is orthogonal to the tier system: it's the material applied to
// discrete physical objects that sit on top of tier-1 glass surfaces
// (palette tiles, library cards, score pages). Tokens live in
// `tokens.css` as `--paper-bg` / `--paper-shadow`, and the `<Paper>`
// primitive in `packages/ui/src/Paper/` consumes them.

// Tier-1 glass panel that hosts a row of paper palette tiles. Mirrors
// what the editor's left palette panel actually looks like with the new
// material applied. We render the *real* `<PaletteButton>` from
// `packages/ui/src/PaletteButton/` so this sample can never drift from
// the production component's hover / pressed / focus recipe.
const PAPER_ON_GLASS_PANEL_STYLE: CSSProperties = {
  padding: 12,
  background: "color-mix(in srgb, var(--surface, #ffffff) 65%, transparent)",
  backdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "var(--radius-md, 10px)",
  boxShadow: "var(--elevation-1, 0 1px 2px rgba(0,0,0,0.08))",
};
const PAPER_TILE_ROW_STYLE: CSSProperties = { display: "flex", gap: 7 };

export function PaperOnGlassSample() {
  return (
    <Stage caption="Paper · palette tiles on tier-1 glass">
      <div style={PAPER_ON_GLASS_PANEL_STYLE}>
        <div style={PAPER_TILE_ROW_STYLE}>
          {/* SMuFL Private Use Area codepoints — match the real editor
              palette (apps/editor/src/components/palette/smuflGlyphs.ts).
              Bravura is registered with unicode-range U+E000-F8FF, so glyphs
              outside that block (e.g. Unicode Musical Symbols U+1D100+)
              would silently fall back to the system serif. */}
          <PaletteButton useBravura label={"\uE050"} title="G clef" />
          <PaletteButton useBravura label={"\uE062"} title="F clef" />
          <PaletteButton useBravura label={"\uE05C"} title="C clef" />
          <PaletteButton useBravura label={"\uE262"} title="Sharp" />
          <PaletteButton useBravura label={"\uE08A"} title="Common time" />
          <PaletteButton useBravura label={"\uE08B"} title="Cut time" />
        </div>
      </div>
    </Stage>
  );
}

const PAPER_CARD_STYLE: CSSProperties = {
  width: 260,
  padding: 18,
  borderRadius: "var(--radius-lg, 8px)",
  background: "var(--paper-bg)",
  backgroundBlendMode: "var(--paper-bg-blend)" as CSSProperties["backgroundBlendMode"],
  boxShadow: "var(--paper-shadow)",
};
const PAPER_CARD_TITLE_STYLE: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600, color: "#1c1c24" };
const PAPER_CARD_SUB_STYLE: CSSProperties = { margin: "4px 0 0", fontSize: 12, color: "#5a5a64" };
const PAPER_CARD_FOOT_STYLE: CSSProperties = { margin: "12px 0 0", fontSize: 11, color: "#85857a" };

// Larger paper sheet — library/score card application.
export function PaperCardSample() {
  return (
    <Stage caption="Paper · card (library / score-page application)">
      <div style={PAPER_CARD_STYLE}>
        <p style={PAPER_CARD_TITLE_STYLE}>Symphony No. 4</p>
        <p style={PAPER_CARD_SUB_STYLE}>Movement II · Andante</p>
        <p style={PAPER_CARD_FOOT_STYLE}>Last edited 3 minutes ago</p>
      </div>
    </Stage>
  );
}
