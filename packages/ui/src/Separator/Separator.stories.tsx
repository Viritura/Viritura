import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { Separator } from "./Separator";
import { Button } from "../Button/Button";

const VERTICAL_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 4, height: 40 };
const GLASS_CARD_STYLE: CSSProperties = {
  width: 200,
  padding: 8,
  background: "rgba(255,255,255,0.35)",
  border: "1px solid rgba(20,20,28,0.08)",
  borderRadius: 8,
  backdropFilter: "blur(8px)",
};
const LIST_ITEM_STYLE: CSSProperties = { padding: "4px 12px", fontSize: 13 };
const TOOLBAR_ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: 8,
  background: "rgba(255,255,255,0.35)",
  border: "1px solid rgba(20,20,28,0.08)",
  borderRadius: 8,
  backdropFilter: "blur(8px)",
};

const meta: Meta<typeof Separator> = {
  title: "UI Components/Separator",
  component: Separator,
  // Separator is used as a menu divider inside the chrome menu bar.
  parameters: { layout: "centered", surface: "chrome" },
  argTypes: {
    orientation: { control: "select", options: ["vertical", "horizontal"] },
  },
};

export default meta;
type Story = StoryObj<typeof Separator>;

export const Vertical: Story = {
  args: { orientation: "vertical" },
  decorators: [
    (Story) => (
      <div style={VERTICAL_ROW_STYLE}>
        <Button label="A" />
        <Story />
        <Button label="B" />
      </div>
    ),
  ],
};

export const Horizontal: Story = {
  args: { orientation: "horizontal" },
  decorators: [
    (Story) => (
      <div style={GLASS_CARD_STYLE}>
        <div style={LIST_ITEM_STYLE}>Item 1</div>
        <Story />
        <div style={LIST_ITEM_STYLE}>Item 2</div>
        <Story />
        <div style={LIST_ITEM_STYLE}>Item 3</div>
      </div>
    ),
  ],
};

export const ToolbarExample: Story = {
  render: () => (
    <div style={TOOLBAR_ROW_STYLE}>
      <Button label="N" active activeColor="#0e639c" />
      <Separator />
      <Button label={String.fromCodePoint(0xeca5)} useBravura tooltip="Quarter" active />
      <Button label={String.fromCodePoint(0xeca7)} useBravura tooltip="Eighth" />
      <Separator />
      <Button label="1" tooltip="Voice 1" />
      <Button label="2" tooltip="Voice 2" />
    </div>
  ),
};
