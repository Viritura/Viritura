import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaletteButton } from "./PaletteButton";
import styles from "./PaletteButton.module.css";

// SMuFL PUA codepoints — mirror apps/editor/src/components/Toolbar.tsx.
// Bravura ships glyphs in the PUA (E000–F8FF), NOT in the Unicode Musical
// Symbols block (1D100+), so codepoints like 1D15F render as ".notdef"
// tofu in the storybook.
const NOTE_WHOLE = "\u{ECA2}";
const NOTE_HALF = "\u{ECA3}";
const NOTE_QUARTER = "\u{ECA5}";
const NOTE_8TH = "\u{ECA7}";
const NOTE_16TH = "\u{ECA9}";
const NOTE_32ND = "\u{ECAB}";
const ARTIC_MARCATO = "\u{E4AC}";

// Match production: PaletteButton grids live directly on the workspace-panel
// glass card with no extra paper substrate. See apps/editor/src/components/
// palette/paletteStyles.ts → wideGridStyle.
const GRID_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))",
  gap: 7,
  width: 280,
};

const ROW_STYLE: CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", padding: 12 };

const meta: Meta<typeof PaletteButton> = {
  title: "UI Components/PaletteButton",
  component: PaletteButton,
  parameters: { layout: "centered" },
  argTypes: {
    shape: { control: "select", options: ["tile", "tall", "wide", "vertical"] },
    selectionMode: { control: "select", options: ["press", "radio"] },
    active: { control: "boolean" },
    disabled: { control: "boolean" },
    useBravura: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof PaletteButton>;

export const Tile: Story = {
  args: { label: NOTE_QUARTER, title: "Quarter note", useBravura: true, shape: "tile" },
};

export const TileActive: Story = {
  args: { label: NOTE_QUARTER, title: "Quarter note", useBravura: true, active: true },
};

export const TileDisabled: Story = {
  args: { label: NOTE_QUARTER, title: "Quarter note", useBravura: true, disabled: true },
};

export const Wide: Story = {
  render: () => (
    <div style={GRID_STYLE}>
      <PaletteButton label={NOTE_WHOLE} title="Whole" useBravura />
      <PaletteButton label={NOTE_HALF} title="Half" useBravura />
      <PaletteButton label="Sustain" title="Sustain pedal" shape="wide" />
      <PaletteButton label={NOTE_QUARTER} title="Quarter" useBravura />
      <PaletteButton label="Una corda" title="Una corda" shape="wide" active />
    </div>
  ),
};

export const Tall: Story = {
  args: { label: ARTIC_MARCATO, title: "Articulation", useBravura: true, shape: "tall" },
};

export const Vertical: Story = {
  args: {
    title: "Standard time signature",
    shape: "vertical",
    selectionMode: "radio",
    active: true,
    children: (
      <span className={styles.storyVerticalContent}>
        <span className={styles.storyVerticalGlyph}>{"\uE084\uE084"}</span>
        <span>Standard</span>
      </span>
    ),
  },
};

export const Grid: Story = {
  render: () => (
    <div style={GRID_STYLE}>
      <PaletteButton label={NOTE_WHOLE} title="Whole" useBravura />
      <PaletteButton label={NOTE_HALF} title="Half" useBravura />
      <PaletteButton label={NOTE_QUARTER} title="Quarter" useBravura active />
      <PaletteButton label={NOTE_8TH} title="Eighth" useBravura />
      <PaletteButton label={NOTE_16TH} title="Sixteenth" useBravura />
      <PaletteButton label={NOTE_32ND} title="32nd" useBravura disabled />
    </div>
  ),
};

export const ShapeRow: Story = {
  render: () => (
    <div style={ROW_STYLE}>
      <PaletteButton label={NOTE_QUARTER} title="tile" useBravura />
      <PaletteButton label={ARTIC_MARCATO} title="tall" useBravura shape="tall" />
      <PaletteButton label="Sustain" title="wide" shape="wide" />
      <PaletteButton title="vertical" shape="vertical">
        <span>Visual preset</span>
      </PaletteButton>
    </div>
  ),
};
