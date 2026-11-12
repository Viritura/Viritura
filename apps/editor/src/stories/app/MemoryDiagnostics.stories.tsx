import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryDiagnosticsSettings } from "../../memoryDiagnostics";

const meta: Meta<typeof MemoryDiagnosticsSettings> = {
  title: "App/Memory Diagnostics",
  component: MemoryDiagnosticsSettings,
  parameters: {
    docs: {
      description: {
        component:
          "Local memory report controls from Rendering settings. The live recorder runs in the editor shell, not this isolated story; unavailable-report actions show an explanatory notification.",
      },
    },
  },
};

export default meta;
export const Settings: StoryObj<typeof MemoryDiagnosticsSettings> = {};
