import { addons } from "storybook/manager-api";
import { create } from "storybook/theming";

addons.setConfig({
  theme: create({
    base: "dark",
    brandTitle: "MNX Renderer — Viritura",
    brandUrl: "/",
    brandTarget: "_self",
    colorPrimary: "#215e4e",
    colorSecondary: "#83c8b3",
    appBg: "#0a0a0a",
    appContentBg: "#141414",
    appBorderColor: "#2a2a2a",
    textColor: "#f5f5f5",
    textMutedColor: "#888",
    barTextColor: "#ccc",
    barSelectedColor: "#83c8b3",
    barBg: "#0a0a0a",
  }),
});
