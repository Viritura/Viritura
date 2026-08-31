import { addons } from "storybook/manager-api";
import { virituraLight } from "./theme";

// Applies the Viritura brand palette (viridian + paper-white) to the
// Storybook manager UI (sidebar, toolbar, addon panel). See ./theme.ts.
addons.setConfig({
  theme: virituraLight,
});
