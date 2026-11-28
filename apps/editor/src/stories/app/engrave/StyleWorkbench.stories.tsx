import type { Meta, StoryObj } from "@storybook/react-vite";
import { StyleWorkbench } from "./StyleWorkbench";

const meta = {
  title: "App/Engrave/Style Workbench",
  component: StyleWorkbench,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Local-state UX prototype using @viritura/ui. The top-nav layout picker includes role, profile, and custom-setting metadata. Edit house style in the project bar switches to a project-wide mode while you keep flipping through layouts. Built-in presets provide starting points; profile values and custom layout settings remain separate. The preview is mock SVG with estimated page counts; refresh resets the demo.",
      },
    },
  },
  argTypes: {
    initialDestination: { control: "radio", options: ["house", "layout", "selection"] },
  },
} satisfies Meta<typeof StyleWorkbench>;

export default meta;
type Story = StoryObj<typeof meta>;
export const HouseStyleWithLayoutList: Story = {
  name: "House style",
  args: { initialDestination: "house" },
};
export const LayoutOverrides: Story = { args: { initialDestination: "layout" } };
