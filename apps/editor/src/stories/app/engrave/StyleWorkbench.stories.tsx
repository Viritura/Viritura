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
          "Local-state UX prototype using @viritura/ui. The panel edits the viewed score or part; Edit house style in the project bar switches to a project-wide mode while you keep flipping through layouts. Layout overrides are preserved. The preview is mock SVG with estimated page counts; refresh resets the demo.",
      },
    },
  },
  argTypes: {
    initialNavigator: { control: "radio", options: ["list", "dropdown"] },
    initialDestination: { control: "radio", options: ["house", "layout", "selection"] },
  },
} satisfies Meta<typeof StyleWorkbench>;

export default meta;
type Story = StoryObj<typeof meta>;
export const HouseStyleWithLayoutList: Story = { args: { initialNavigator: "list", initialDestination: "house" } };
export const TopNavDropdown: Story = { args: { initialNavigator: "dropdown", initialDestination: "house" } };
export const LayoutOverrides: Story = { args: { initialNavigator: "list", initialDestination: "layout" } };
