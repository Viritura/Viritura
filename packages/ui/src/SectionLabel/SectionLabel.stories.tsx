import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { GitCompareArrows, History, Layers } from "lucide-react";
import { SectionLabel } from "./SectionLabel";

const DECORATOR_STYLE: CSSProperties = { width: 320 };
const STACKED_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };

const meta: Meta<typeof SectionLabel> = {
  title: "UI Components/SectionLabel",
  component: SectionLabel,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={DECORATOR_STYLE}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SectionLabel>;

export const Plain: Story = {
  args: { label: "History" },
};

export const WithIcon: Story = {
  args: { label: "History", icon: <History size={11} /> },
};

export const WithBadge: Story = {
  args: { label: "Changes", badge: 9 },
};

export const WithIconAndBadge: Story = {
  args: {
    label: "Changes",
    icon: <GitCompareArrows size={11} />,
    badge: 9,
  },
};

export const Stacked: Story = {
  render: () => (
    <div style={STACKED_STYLE}>
      <SectionLabel label="Layers" icon={<Layers size={11} />} badge={3} />
      <SectionLabel label="Changes" icon={<GitCompareArrows size={11} />} badge={9} />
      <SectionLabel label="History" icon={<History size={11} />} />
    </div>
  ),
};
