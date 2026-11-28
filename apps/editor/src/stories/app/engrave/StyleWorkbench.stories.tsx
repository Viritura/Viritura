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
          "Disposable, local-state UX prototype using @viritura/ui. The project house style is the default for every score and part. It holds shared settings plus layout profiles (Full score, Part, Large-print part) that define page size, orientation, margins, staff size and turn policy. Edit a profile, then flip through layouts in the always-visible list or the All layouts overview to see the result across the project. Layout overrides stay protected. Refresh resets all mock data. The preview is to-scale mock SVG, not real engraving. No document, personal preference, or production store is modified.",
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
