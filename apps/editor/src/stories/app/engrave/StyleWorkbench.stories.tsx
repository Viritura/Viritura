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
          "Disposable, local-state UX prototype using @viritura/ui. Compare destination tabs with scope-first navigation using the on-screen switch. Try changing Part defaults, overriding a Cello field, adopting Film while preserving overrides, copying a category, and undoing. Refresh resets all mock data. The preview is illustrative SVG, not real engraving. No document, personal preference, or production store is modified.",
      },
    },
  },
  argTypes: { initialNavigation: { control: "radio", options: ["tabs", "scope-first"] } },
} satisfies Meta<typeof StyleWorkbench>;

export default meta;
type Story = StoryObj<typeof meta>;
export const DestinationTabs: Story = { args: { initialNavigation: "tabs" } };
export const ScopeFirst: Story = { args: { initialNavigation: "scope-first" } };
