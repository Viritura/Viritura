import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MultiSelectPopover } from "./MultiSelectPopover";

const meta: Meta<typeof MultiSelectPopover> = {
  title: "UI Components/MultiSelectPopover",
  component: MultiSelectPopover,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof MultiSelectPopover>;

export const PlacementGroups: Story = {
  args: {
    value: ["above-system"],
    ariaLabel: "Placement",
    groups: [
      {
        label: "System",
        options: [
          { value: "above-system", label: "Above the whole system" },
          { value: "below-system", label: "Below the whole system" },
        ],
      },
      {
        label: "Bracket groups",
        options: [
          { value: "strings", label: "Above Strings bracket" },
          { value: "keyboard", label: "Above Keyboard bracket" },
        ],
      },
    ],
  },
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return <MultiSelectPopover {...args} value={value} onValueChange={setValue} />;
  },
};

export const MultipleSelections: Story = {
  ...PlacementGroups,
  args: { ...PlacementGroups.args, value: ["above-system", "strings", "keyboard"] },
};
