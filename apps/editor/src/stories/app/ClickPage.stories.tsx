import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClickPage } from "../../click";

const meta: Meta<typeof ClickPage> = {
  title: "App/Click",
  component: ClickPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
export const OpenMnx: StoryObj<typeof ClickPage> = {};
