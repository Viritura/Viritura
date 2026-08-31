import type { Meta, StoryObj } from "@storybook/react-vite";
import { CascadingMenu } from "./CascadingMenu";
import type { CascadingMenuItem } from "./types";

const fileItems: CascadingMenuItem[] = [
  { id: "new", label: "New Score", onSelect: () => {} },
  { id: "open", label: "Open…", onSelect: () => {} },
  { id: "save", label: "Save", onSelect: () => {} },
  { id: "sep-1", separator: true },
  { id: "export", label: "Export as PDF", onSelect: () => {} },
  {
    id: "recent",
    label: "Open Recent",
    children: [
      { id: "recent-1", label: "score1.mnx", onSelect: () => {} },
      { id: "recent-2", label: "score2.mnx", onSelect: () => {} },
      { id: "sep-2", separator: true },
      { id: "clear", label: "Clear Recent", disabled: true },
    ],
  },
];

const meta: Meta<typeof CascadingMenu> = {
  title: "UI Components/CascadingMenu",
  component: CascadingMenu,
  parameters: { layout: "centered", surface: "chrome" },
};

export default meta;
type Story = StoryObj<typeof CascadingMenu>;

export const Default: Story = {
  args: { ariaLabel: "File menu", label: "File", items: fileItems },
};

export const Empty: Story = {
  args: { ariaLabel: "Empty menu", label: "Empty", items: [{ id: "none", label: "(no items)", disabled: true }] },
};
