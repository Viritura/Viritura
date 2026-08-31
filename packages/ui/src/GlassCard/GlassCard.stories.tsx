import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { FolderPlus } from "lucide-react";
import { GlassCard } from "./GlassCard";

const DECORATOR_STYLE: CSSProperties = { width: 320 };
const PARA_STYLE: CSSProperties = { margin: 0, fontSize: "0.78rem", color: "var(--text)" };
const PARA_LIGHT_STYLE: CSSProperties = { margin: 0, fontSize: "0.75rem", color: "#6a6a74", lineHeight: 1.5 };
const PARA_CENTER_STYLE: CSSProperties = { margin: 0, fontSize: "0.7rem", color: "#6a6a74", textAlign: "center" };
const COMPACT_TEXT_STYLE: CSSProperties = { fontSize: "0.72rem", color: "var(--text)" };
const SETUP_BUTTON_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "8px 12px",
  fontSize: "0.78rem",
  fontWeight: 600,
  color: "#fff",
  background: "rgba(var(--accent-rgb, 33, 94, 78), 0.9)",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
};

const meta: Meta<typeof GlassCard> = {
  title: "UI Components/GlassCard",
  component: GlassCard,
  // GlassCard IS the Tier-1 glass surface — render on the raw
  // workspace gradient, not inside another glass panel.
  parameters: { layout: "centered", surface: "canvas" },
  decorators: [
    (Story) => (
      <div style={DECORATOR_STYLE}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof GlassCard>;

export const Plain: Story = {
  args: {
    children: <p style={PARA_STYLE}>Translucent surface sitting on the workspace gradient.</p>,
  },
};

export const WithTitle: Story = {
  args: {
    title: "Version history",
    children: <p style={PARA_LIGHT_STYLE}>Pick a folder. Viritura will save your score there with version history.</p>,
  },
};

export const SetupCard: Story = {
  name: "Setup card (Review)",
  render: () => (
    <GlassCard>
      <p style={PARA_STYLE}>Standalone files don&apos;t track version history.</p>
      <button type="button" style={SETUP_BUTTON_STYLE}>
        <FolderPlus size={14} />
        Set up version history…
      </button>
      <p style={PARA_CENTER_STYLE}>Pick a folder. Viritura will save your score there with version history.</p>
    </GlassCard>
  ),
};

export const Compact: Story = {
  args: {
    padding: "compact",
    children: <span style={COMPACT_TEXT_STYLE}>Compact density.</span>,
  },
};
