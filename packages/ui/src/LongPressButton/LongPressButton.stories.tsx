import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { LongPressButton } from "./LongPressButton";

// SMuFL codepoints used by the production toolbar — mirrored here so the
// stories render the *exact* glyphs and option sets shipped in
// `apps/editor/src/components/Toolbar.tsx`.
const SMUFL = {
  metNoteQuarter: String.fromCodePoint(0xeca5),
  augDot: String.fromCodePoint(0xecb7),
  graceNoteAcciaccatura: String.fromCodePoint(0xe560),
  graceNoteAppoggiatura: String.fromCodePoint(0xe562),
};

type GraceType = "grace" | "appoggiatura";
type DotCount = 1 | 2 | 3 | 4;

const meta: Meta<typeof LongPressButton> = {
  title: "UI Components/LongPressButton",
  component: LongPressButton,
  // LongPressButton lives in `Toolbar.tsx` (Tier-2 chrome). The decorator
  // gives the Radix popover symmetric horizontal room to anchor against;
  // collision-padding still kicks in when the viewport is narrower.
  parameters: { layout: "centered", surface: "chrome" },
  decorators: [
    (Story) => (
      <div style={STORY_WRAP_STYLE}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof LongPressButton>;

const STORY_WRAP_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.75rem",
  minWidth: "20rem",
  padding: "1.5rem 2rem",
};

const HINT_STYLE: CSSProperties = {
  fontSize: "0.7rem",
  color: "var(--text-muted)",
  fontFamily: "monospace",
};

const AUG_DOT_ROW_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: "1px",
};

const AUG_DOT_SPAN_STYLE: CSSProperties = {
  letterSpacing: "-2px",
};

/**
 * Production grace-note button from `Toolbar.tsx`.
 *
 * - Bravura SMuFL glyphs for both options and the trigger.
 * - `selectedValue` is always `"grace" | "appoggiatura"` — picker memory,
 *   never null. Long-press to switch.
 * - `active` is the on/off bit. Single-click flips it; the glyph stays
 *   visible either way so the user can see *what* would be applied.
 */
export const GraceNote: Story = {
  render: () => {
    const [selected, setSelected] = useState<GraceType>("grace");
    const [active, setActive] = useState(false);
    return (
      <>
        <LongPressButton
          title={
            active
              ? `Grace note: ${selected === "grace" ? "Acciaccatura (slashed)" : "Appoggiatura (unslashed)"}`
              : "Grace note (click to toggle, right-click for options)"
          }
          options={[
            { label: SMUFL.graceNoteAcciaccatura, title: "Acciaccatura (slashed)", value: "grace" },
            { label: SMUFL.graceNoteAppoggiatura, title: "Appoggiatura (unslashed)", value: "appoggiatura" },
          ]}
          selectedValue={selected}
          active={active}
          onToggle={() => setActive((a) => !a)}
          onSelectedChange={(v) => {
            setSelected(v as GraceType);
            setActive(true);
          }}
          useBravura
          testId="story-grace"
        >
          <span>{selected === "appoggiatura" ? SMUFL.graceNoteAppoggiatura : SMUFL.graceNoteAcciaccatura}</span>
        </LongPressButton>
        <span style={HINT_STYLE}>
          selected = {JSON.stringify(selected)}, active = {String(active)}
        </span>
      </>
    );
  },
};

/**
 * Production augmentation-dot button from `Toolbar.tsx`.
 *
 * - Trigger renders a Bravura quarter note plus N augmentation dots, where
 *   N is `selectedValue` — so the off-state shows a ghost of "what you'd
 *   apply" rather than always one dot.
 * - Options are 1-4 dots with text labels (no Bravura needed for those).
 */
export const AugmentationDot: Story = {
  render: () => {
    const [selected, setSelected] = useState<DotCount>(1);
    const [active, setActive] = useState(false);
    return (
      <>
        <LongPressButton
          title={
            active
              ? `${selected} dot${selected > 1 ? "s" : ""} (click to remove, right-click for options)`
              : `Augmentation dot — ${selected} dot${selected > 1 ? "s" : ""} (click to apply, right-click for options)`
          }
          options={[
            { label: "1.", title: "Single dot", value: 1 },
            { label: "2..", title: "Double dot", value: 2 },
            { label: "3...", title: "Triple dot", value: 3 },
            { label: "4....", title: "Quadruple dot", value: 4 },
          ]}
          selectedValue={selected}
          active={active}
          onToggle={() => setActive((a) => !a)}
          onSelectedChange={(v) => {
            setSelected(v as DotCount);
            setActive(true);
          }}
          useBravura
          testId="story-dot"
        >
          <span style={AUG_DOT_ROW_STYLE}>
            <span>{SMUFL.metNoteQuarter}</span>
            <span style={AUG_DOT_SPAN_STYLE}>{SMUFL.augDot.repeat(selected)}</span>
          </span>
        </LongPressButton>
        <span style={HINT_STYLE}>
          selected = {selected}, active = {String(active)}
        </span>
      </>
    );
  },
};
