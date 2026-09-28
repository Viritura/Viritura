import { useEffect, useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TextContent } from "@viritura/core";
import { loadMusicFont } from "@viritura/renderer";
import { FormField } from "@viritura/ui";
import { TextContentEditor } from "../../components/inspector/TextContentEditor";

const PANEL_STYLE: CSSProperties = {
  width: 300,
  padding: 16,
  background: "var(--surface)",
  borderRadius: 12,
};

const PREVIEW_STYLE: CSSProperties = {
  marginTop: 16,
  fontSize: 12,
  whiteSpace: "pre-wrap",
  color: "var(--text-muted)",
};

const RICH_VALUE: TextContent = [
  { text: "sempre ", style: { fontStyle: "italic" } },
  { glyphs: ["dynamicPP"] },
  { text: " dolce", style: { fontStyle: "italic" } },
];

function ScoreTextHarness({ initial }: { initial: TextContent }) {
  const [value, setValue] = useState<TextContent>(initial);
  // The app registers Bravura when a score canvas paints; do it here so the
  // glyph chips and picker previews render outside the score view.
  useEffect(() => void loadMusicFont(), []);
  return (
    <div style={PANEL_STYLE}>
      <FormField label="Text">
        <TextContentEditor value={value} onChange={setValue} placeholder="Expression text" ariaLabel="Text" />
      </FormField>
      <pre style={PREVIEW_STYLE}>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

const meta: Meta<typeof ScoreTextHarness> = {
  title: "App/Score Text Editor",
  component: ScoreTextHarness,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof ScoreTextHarness>;

/** A single unstyled text run — the simplest well-formed content. */
export const PlainText: Story = { args: { initial: [{ text: "dolce" }] } };

/** Mixed styled text and SMuFL glyph runs. */
export const StyledWithGlyphs: Story = { args: { initial: RICH_VALUE } };

export const Empty: Story = { args: { initial: [] } };
