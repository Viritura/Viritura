import type { Preview } from "@storybook/react-vite";
import { useEffect } from "react";
import { TooltipPrimitives } from "../src/Tooltip/Tooltip";
import { virituraLight } from "./theme";
import "../src/tokens.css";
import "../src/reset.css";

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
  // The workspace mesh gradient is painted globally by preview-head.html so
  // every story sees the same backdrop translucent surfaces (GlassCard,
  // glass Select trigger, PanelHeader) sit on in the app. Stories that
  // need a flat reference background can opt out via
  // `parameters: { backgroundOverride: "white" | "black" }` and this
  // decorator will toggle `data-bg` on the iframe body. The Storybook
  // backgrounds addon isn't installed in this config, which is why the
  // old `backgrounds.default` parameter was a silent no-op.
  decorators: [
    (Story, context) => {
      const override = (context.parameters as { backgroundOverride?: "white" | "black" }).backgroundOverride;
      useEffect(() => {
        const { body } = document;
        if (override) body.setAttribute("data-bg", override);
        else body.removeAttribute("data-bg");
        return () => body.removeAttribute("data-bg");
      }, [override]);
      // Hoisted Tooltip provider so every primitive that uses `withTooltip`
      // works inside stories without per-story setup. Settings mirror AppShell.
      return (
        <TooltipPrimitives.Provider delayDuration={400} skipDelayDuration={100}>
          <Story />
        </TooltipPrimitives.Provider>
      );
    },
  ],
};

export default preview;
