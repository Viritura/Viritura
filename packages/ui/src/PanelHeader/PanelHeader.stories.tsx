import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PanelHeader, PanelActionButton } from "./PanelHeader";

// No background — we want the Storybook gradient bg to show
// through the PanelHeader's translucent surface.
const DECORATOR_STYLE: CSSProperties = { width: 320, borderRadius: 8, overflow: "hidden" };

const meta: Meta<typeof PanelHeader> = {
  title: "UI Components/PanelHeader",
  // PanelHeader is the top of a Tier-1 glass panel — it's a surface
  // component, not panel contents, so it renders on the raw canvas.
  // Default surface: canvas (set on meta below).
  component: PanelHeader,
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
type Story = StoryObj<typeof PanelHeader>;

export const TitleOnly: Story = {
  args: { title: "Clipboard History" },
};

export const WithSubtitle: Story = {
  args: {
    title: "Mixer",
    subtitle: "12 instruments · 3 buses",
  },
};

export const WithClose: Story = {
  args: { title: "MNX Source", onClose: fn() },
};

export const WithActions: Story = {
  args: {
    title: "History",
    actions: <PanelActionButton onClick={fn()}>Clear</PanelActionButton>,
  },
};

export const ToggleGroup: Story = {
  name: "Actions / Toggle group (active)",
  args: {
    title: "Diff",
    actions: (
      <>
        <PanelActionButton active>Snippets (9)</PanelActionButton>
        <PanelActionButton>Full File</PanelActionButton>
      </>
    ),
  },
};

export const WithActionsAndClose: Story = {
  args: {
    title: "AI Assistant",
    actions: <PanelActionButton>Settings</PanelActionButton>,
    onClose: fn(),
  },
};
