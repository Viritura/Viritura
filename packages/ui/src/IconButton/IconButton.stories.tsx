import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton";

const ACTIVITY_BAR_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  width: 48,
  padding: 4,
  borderRadius: 8,
};

const StarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const PenIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="M2 2l7.586 7.586" />
  </svg>
);

const meta: Meta<typeof IconButton> = {
  title: "UI Components/IconButton",
  component: IconButton,
  parameters: { layout: "centered" },
  argTypes: {
    size: { control: "select", options: ["sm", "md", "lg"] },
    active: { control: "boolean" },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {
  args: { children: <StarIcon />, tooltip: "Star" },
};

export const Active: Story = {
  args: { children: <PenIcon />, tooltip: "Write", active: true },
};

export const Disabled: Story = {
  args: { children: <StarIcon />, tooltip: "Star", disabled: true },
};

export const Small: Story = {
  args: { children: <StarIcon />, tooltip: "Star", size: "sm" },
};

export const Medium: Story = {
  args: { children: <StarIcon />, tooltip: "Star", size: "md" },
};

export const ActivityBarExample: Story = {
  render: () => (
    <div style={ACTIVITY_BAR_STYLE}>
      <IconButton tooltip="Write" active>
        <PenIcon />
      </IconButton>
      <IconButton tooltip="Star">
        <StarIcon />
      </IconButton>
      <IconButton tooltip="Star">
        <StarIcon />
      </IconButton>
    </div>
  ),
};
