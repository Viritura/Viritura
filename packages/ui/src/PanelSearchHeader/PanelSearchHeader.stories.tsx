import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PanelSearchHeader } from "./PanelSearchHeader";

const PREVIEW_STYLE: CSSProperties = { width: 320 };

const meta: Meta<typeof PanelSearchHeader> = {
  title: "UI Components/PanelSearchHeader",
  component: PanelSearchHeader,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={PREVIEW_STYLE}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof PanelSearchHeader>;

export const Default: Story = {
  render: () => {
    const [query, setQuery] = useState("");
    const [anyOpen, setAnyOpen] = useState(true);
    return (
      <PanelSearchHeader
        value={query}
        onValueChange={setQuery}
        placeholder="Search palettes..."
        searchLabel="Search palettes"
        anyOpen={anyOpen}
        onToggleAll={() => setAnyOpen((open) => !open)}
        toggleLabel={anyOpen ? "Collapse all palette sections" : "Expand all palette sections"}
      />
    );
  },
};

export const Filtering: Story = {
  render: () => {
    const [query, setQuery] = useState("font");
    const [anyOpen, setAnyOpen] = useState(true);
    return (
      <PanelSearchHeader
        value={query}
        onValueChange={setQuery}
        placeholder="Search house style..."
        searchLabel="Search house style"
        anyOpen={query !== "" || anyOpen}
        onToggleAll={() => setAnyOpen((open) => !open)}
        toggleLabel={query !== "" || anyOpen ? "Collapse all House Style sections" : "Expand all House Style sections"}
        toggleDisabled={query !== ""}
      />
    );
  },
};
