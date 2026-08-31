import type { Preview } from "@storybook/react-vite";
import { createElement } from "react";
import { TooltipPrimitives } from "@viritura/ui";
import "@viritura/ui/tokens.css";
import "@viritura/ui/reset.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    options: {
      storySort: {
        order: ["App", ["Start Center", "Onboarding", "Engrave Mode", "Modes", "*"], "Embeddable", "*"],
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "workspace",
      values: [
        {
          name: "workspace",
          // Mirrors `.workspace-bg` in apps/editor/src/styles/workspaceChrome.css
          // (Editorial Cool mesh — slate + bone + viridian) so translucent
          // surfaces (PanelHeader, GlassCard, etc.) render against the same
          // backdrop they live on in the app.
          value:
            "radial-gradient(circle at 12% 18%, rgba(58,142,122,0.38), transparent 55%), radial-gradient(circle at 88% 82%, rgba(244,200,120,0.32), transparent 55%), radial-gradient(circle at 70% 12%, rgba(95,170,220,0.32), transparent 50%), radial-gradient(circle at 22% 90%, rgba(178,140,220,0.30), transparent 55%), linear-gradient(180deg, #e8ecef 0%, #dde2e7 100%)",
        },
        {
          name: "workspace-dark",
          // Mirrors the [data-theme=dark] variant of .workspace-bg.
          value:
            "radial-gradient(circle at 12% 18%, rgba(80,120,220,0.50), transparent 55%), radial-gradient(circle at 88% 82%, rgba(170,90,180,0.45), transparent 55%), radial-gradient(circle at 70% 12%, rgba(78,200,170,0.40), transparent 50%), radial-gradient(circle at 22% 90%, rgba(220,90,110,0.35), transparent 55%), linear-gradient(180deg, #1c1c24 0%, #16161e 100%)",
        },
        { name: "white", value: "#ffffff" },
        { name: "black", value: "#0c0c10" },
      ],
    },
  },
  // Hoisted Tooltip provider mirrors AppShell so every primitive that uses
  // `withTooltip` works inside stories without per-story setup.
  decorators: [
    (Story) =>
      createElement(TooltipPrimitives.Provider, { delayDuration: 400, skipDelayDuration: 100 }, createElement(Story)),
  ],
};

export default preview;
