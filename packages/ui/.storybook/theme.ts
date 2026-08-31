import { create } from "storybook/theming";

// Viritura-branded Storybook chrome.
// Pulls from packages/ui/src/tokens.css so the manager UI (sidebar, toolbar,
// addon panel) matches the design language reviewers see in the canvas.
//
// Palette source:
//   --accent (light) = #215e4e   (deep viridian)
//   --accent (dark)  = #83c8b3   (accessible tint)
// We use the light viridian as the primary brand color and a paper-white
// neutral palette for the chrome, mirroring the default light tokens.
export const virituraLight = create({
  base: "light",

  // Brand
  brandTitle: "Viritura UI",
  brandTarget: "_self",

  // Color palette
  colorPrimary: "#215e4e", // deep viridian accent
  colorSecondary: "#215e4e",

  // UI
  appBg: "#ececee", // --bg
  appContentBg: "#efeff1", // --surface
  appPreviewBg: "#efeff1",
  appBorderColor: "#d4d4d8", // --border
  appBorderRadius: 6, // --radius-md

  // Text
  textColor: "#2a2a30", // --text
  textInverseColor: "#ffffff",
  textMutedColor: "#5d5d65", // --text-muted

  // Toolbar default and active colors
  barTextColor: "#5d5d65",
  barSelectedColor: "#215e4e",
  barHoverColor: "#215e4e",
  barBg: "#f5f5f7", // --surface-raised

  // Form colors
  inputBg: "rgba(255, 255, 255, 0.55)", // --surface-input
  inputBorder: "rgba(20, 20, 28, 0.14)", // --border-input
  inputTextColor: "#2a2a30",
  inputBorderRadius: 6,

  // Typography
  fontBase: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontCode: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
});

export const virituraDark = create({
  base: "dark",

  brandTitle: "Viritura UI",
  brandTarget: "_self",

  colorPrimary: "#83c8b3", // accessible viridian tint
  colorSecondary: "#83c8b3",

  appBg: "#1c1c24",
  appContentBg: "#26262e", // --bg (dark)
  appPreviewBg: "#26262e",
  appBorderColor: "#3a3a42", // --border (dark)
  appBorderRadius: 6,

  textColor: "#e2e2e8", // --text (dark)
  textInverseColor: "#131318",
  textMutedColor: "#b0b0ba", // --text-muted (dark)

  barTextColor: "#b0b0ba",
  barSelectedColor: "#83c8b3",
  barHoverColor: "#83c8b3",
  barBg: "#2c2c34", // --surface-raised (dark)

  inputBg: "rgba(255, 255, 255, 0.06)",
  inputBorder: "rgba(255, 255, 255, 0.14)",
  inputTextColor: "#e2e2e8",
  inputBorderRadius: 6,

  fontBase: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontCode: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
});
