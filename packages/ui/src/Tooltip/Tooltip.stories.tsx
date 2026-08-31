import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tooltip } from "./Tooltip";

const meta: Meta<typeof Tooltip> = {
  title: "UI Components/Tooltip",
  component: Tooltip,
  // Tooltip is a Tier-3 floating glass popover — it carries its own
  // surface. Showing it on top of another glass panel would stack
  // glass-on-glass (mushy double-blur per Material Tiers spec), so
  // render against the raw canvas.
  // The hoisted TooltipPrimitives.Provider lives in `.storybook/preview.{ts,tsx}`,
  // so no per-story decorator is needed.
  parameters: { layout: "centered", surface: "canvas" },
  argTypes: {
    content: { control: "text" },
    side: { control: "select", options: ["top", "bottom", "left", "right"] },
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
  args: {
    content: "This is a tooltip",
    children: <button>Hover me</button>,
  },
};

export const Top: Story = {
  args: {
    content: "Tooltip on top",
    side: "top",
    children: <button>Top tooltip</button>,
  },
};

export const Left: Story = {
  args: {
    content: "Tooltip on the left",
    side: "left",
    children: <button>Left tooltip</button>,
  },
};
