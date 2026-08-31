import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { InstrumentProfilesPanel } from "../../instrumentProfiles";

const PAGE_STYLE: CSSProperties = {
  padding: "1.5rem",
  color: "var(--text)",
  minHeight: "100vh",
  maxWidth: 820,
};

/**
 * The Settings → Instrument Profiles panel.
 *
 * Two views in one pane. The list shows the built-in VirituraSounds entry plus
 * user-defined VST profiles, each with a readiness indicator and edit /
 * duplicate / delete icon actions. Editing swaps the pane for the profile
 * editor rather than opening a dialog — this panel already lives inside the
 * settings dialog.
 *
 * The editor is laid out like the percussion editor: instruments on the left
 * grouped by orchestral section, the selected instrument's bindings (name, Lua
 * script, VST plugin, captured state) on the right. "+ Add new" adds a
 * predefined catalog instrument (repeatable — Violin 1, Violin 2, …) or a
 * custom one, which is created under an auto-numbered name and selected for
 * renaming in place.
 *
 * In the browser, file pickers fall back to a path prompt and plugin-state
 * capture is stubbed (desktop-only); persistence is localStorage-backed.
 */
const meta: Meta<typeof InstrumentProfilesPanel> = {
  title: "App/Settings/Instrument Profiles",
  component: InstrumentProfilesPanel,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof InstrumentProfilesPanel>;

export const Default: Story = {
  render: () => (
    <div style={PAGE_STYLE}>
      <InstrumentProfilesPanel />
    </div>
  ),
};
