import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { GlyphButtonGroup } from "./GlyphButtonGroup";

const meta: Meta<typeof GlyphButtonGroup> = {
  title: "UI Components/GlyphButtonGroup",
  component: GlyphButtonGroup,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof GlyphButtonGroup>;

export const Accidentals: Story = {
  render: function Render() {
    const [value, setValue] = useState("bare");
    return (
      <GlyphButtonGroup
        ariaLabel="Accidental enclosure"
        value={value}
        onChange={setValue}
        options={[
          { value: "bare", glyph: "\uE262", label: "Bare" },
          { value: "parentheses", glyph: "\uE26A\uE262\uE26B", label: "Parentheses" },
          { value: "brackets", glyph: "\uE26C\uE262\uE26D", label: "Brackets" },
        ]}
      />
    );
  },
};
