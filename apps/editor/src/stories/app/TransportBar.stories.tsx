/**
 * Storybook story for the TransportBar component.
 *
 * Showcases the compact transport bar with playback controls,
 * metronome toggle, and time display — in light/dark/midnight themes.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { TransportBar } from "@viritura/playback";

const WIDTH_FULL_STYLE: CSSProperties = { width: "100%" };
const KEY_HINTS_CARD_STYLE: CSSProperties = {
  padding: 24,
  background: "var(--bg)",
  color: "var(--text-muted)",
  fontSize: "var(--type-small-size)",
  lineHeight: 1.6,
};
const KEY_HINTS_TITLE_STYLE: CSSProperties = { color: "var(--text)", marginBottom: 8 };
const KEY_HINTS_LIST_STYLE: CSSProperties = {
  listStyle: "none",
  padding: 0,
  display: "flex",
  gap: 16,
  flexWrap: "wrap",
};
import { PlaybackProvider } from "@viritura/playback";

function TransportBarWrapper() {
  return (
    <PlaybackProvider>
      <div style={WIDTH_FULL_STYLE}>
        <TransportBar />
        <div style={KEY_HINTS_CARD_STYLE}>
          <h3 style={KEY_HINTS_TITLE_STYLE}>Keyboard Shortcuts</h3>
          <ul style={KEY_HINTS_LIST_STYLE}>
            <li>
              <kbd style={kbdStyle}>Space</kbd> Play / Pause
            </li>
            <li>
              <kbd style={kbdStyle}>Escape</kbd> Stop
            </li>
            <li>
              <kbd style={kbdStyle}>Ctrl+M</kbd> Toggle Metronome
            </li>
          </ul>
        </div>
      </div>
    </PlaybackProvider>
  );
}

const kbdStyle: React.CSSProperties = {
  padding: "2px 6px",
  borderRadius: 4,
  background: "var(--surface-raised)",
  boxShadow: "var(--elevation-0)",
  fontSize: "var(--type-eyebrow-size)",
  fontFamily: "monospace",
  marginRight: 4,
};

const meta: Meta = {
  title: "App/Transport Bar",
  component: TransportBarWrapper,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;

/** Default transport bar with all controls. */
export const Default: StoryObj = {
  render: () => <TransportBarWrapper />,
  name: "Transport Bar",
};

/** Dark theme variant. */
export const DarkTheme: StoryObj = {
  render: () => {
    document.documentElement.setAttribute("data-theme", "dark");
    return <TransportBarWrapper />;
  },
  name: "Dark Theme",
};

/** Light theme variant. */
export const LightTheme: StoryObj = {
  render: () => {
    document.documentElement.setAttribute("data-theme", "light");
    return <TransportBarWrapper />;
  },
  name: "Light Theme",
};
