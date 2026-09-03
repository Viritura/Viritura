import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { Collapsible } from "./Collapsible";

const ARTICULATIONS_STYLE: CSSProperties = { display: "flex", gap: 4, padding: "0 8px" };
const PALETTE_TEXT_STYLE: CSSProperties = { padding: "0 8px", fontSize: 13, color: "var(--text)" };
const MULTI_WRAP_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
const SECTION_ROW_STYLE: CSSProperties = { padding: "4px 8px", fontSize: 12, color: "var(--text)" };

const glassPanel = {
  width: 280,
  padding: 4,
  borderRadius: 10,
  border: "1px solid rgba(20,20,28,0.08)",
  background: "rgba(255,255,255,0.35)",
  backdropFilter: "blur(8px)",
} as const;

const paletteButton = {
  width: 32,
  height: 32,
  borderRadius: 6,
  border: "1px solid rgba(20,20,28,0.1)",
  background: "rgba(255,255,255,0.55)",
  cursor: "pointer",
  fontFamily: "Bravura, serif",
  fontSize: "1.2rem",
} as const;

const meta: Meta<typeof Collapsible> = {
  title: "UI Components/Collapsible",
  component: Collapsible,
  parameters: { layout: "centered" },
  argTypes: { defaultOpen: { control: "boolean" } },
  decorators: [
    (Story) => (
      <div style={glassPanel}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Collapsible>;

export const Closed: Story = {
  args: {
    title: "Articulations",
    children: (
      <div style={ARTICULATIONS_STYLE}>
        <button style={paletteButton}>{String.fromCodePoint(0xe4a2)}</button>
        <button style={paletteButton}>{String.fromCodePoint(0xe4a0)}</button>
        <button style={paletteButton}>{String.fromCodePoint(0xe4a4)}</button>
      </div>
    ),
  },
};

export const Open: Story = {
  args: {
    title: "Dynamics",
    defaultOpen: true,
    children: <div style={PALETTE_TEXT_STYLE}>Dynamic palette items would go here</div>,
  },
};

export const WithIcon: Story = {
  args: {
    title: "Grace Notes",
    icon: "🎵",
    defaultOpen: true,
    children: <div style={PALETTE_TEXT_STYLE}>Grace note options</div>,
  },
};

export const MultipleSections: Story = {
  render: () => (
    <div style={MULTI_WRAP_STYLE}>
      <Collapsible title="Articulations" defaultOpen>
        <div style={SECTION_ROW_STYLE}>Staccato, Accent, Tenuto…</div>
      </Collapsible>
      <Collapsible title="Dynamics">
        <div style={SECTION_ROW_STYLE}>pp, p, mp, mf, f, ff…</div>
      </Collapsible>
      <Collapsible title="Ornaments">
        <div style={SECTION_ROW_STYLE}>Trill, Turn, Mordent…</div>
      </Collapsible>
    </div>
  ),
};
