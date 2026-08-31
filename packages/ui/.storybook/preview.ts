import type { Preview } from "@storybook/react-vite";
import { createElement, useEffect } from "react";
import { TooltipPrimitives } from "../src/Tooltip/Tooltip";
import { virituraLight } from "./theme";
import "../src/tokens.css";
import "../src/reset.css";
import "./preview.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    docs: {
      theme: virituraLight,
    },
    options: {
      storySort: {
        order: [
          "Introduction",
          "*",
          "Design Language",
          ["Overview", "Material Tiers", "Color", "Elevation", "Radii & Spacing", "Typography", "Motion", "*"],
          "UI Components",
          "*",
        ],
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  // The workspace mesh gradient is painted globally by preview.css so
  // every story sees the same backdrop translucent surfaces (GlassCard,
  // glass Select trigger, PanelHeader) sit on in the app. Stories that
  // need a flat reference background can opt out via
  // `parameters: { backgroundOverride: "white" | "black" }` and this
  // decorator toggles `data-bg` on the iframe body. The Storybook
  // backgrounds addon isn't installed in this config, which is why the
  // old `backgrounds.default` parameter was a silent no-op.
  //
  // Atomic components (Button, Input, Select, etc.) live INSIDE a
  // Tier-1 glass surface in the real app — see Design Language →
  // Material Tiers. The same decorator wraps every story in a
  // `.sbGlassFrame` panel so reviews show components in their
  // production context. Stories that are themselves a surface
  // (GlassCard, PanelHeader, Section, Dialog, StatusBar, the brand
  // marks, MaterialTiers samples) opt out via
  // `parameters: { surface: "canvas" }`. Modals carry their own
  // backdrop via `parameters: { surface: "modal" }`. Both skip the
  // wrapper and render directly on the gradient.
  decorators: [
    (Story, context) => {
      const params = context.parameters as {
        backgroundOverride?: "white" | "black";
        surface?: "glass" | "chrome" | "canvas" | "modal";
      };
      const override = params.backgroundOverride;
      const surface = params.surface ?? "glass";
      useEffect(() => {
        const { body } = document;
        if (override) body.setAttribute("data-bg", override);
        else body.removeAttribute("data-bg");
        return () => body.removeAttribute("data-bg");
      }, [override]);
      const storyEl = createElement(Story);
      let wrapped: ReturnType<typeof createElement> = storyEl;
      if (surface === "glass") wrapped = createElement("div", { className: "sbGlassFrame" }, storyEl);
      else if (surface === "chrome") wrapped = createElement("div", { className: "sbChromeFrame" }, storyEl);
      else if (surface === "modal") wrapped = createElement("div", { className: "sbModalFrame" }, storyEl);
      // Hoisted Tooltip provider mirrors AppShell's settings so every primitive
      // that uses `withTooltip` works inside stories without per-story setup.
      return createElement(TooltipPrimitives.Provider, { delayDuration: 400, skipDelayDuration: 100 }, wrapped);
    },
  ],
};

export default preview;
