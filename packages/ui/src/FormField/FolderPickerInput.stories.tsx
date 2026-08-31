import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "./FormField";
import { FolderPickerInput } from "./FolderPickerInput";

const STORY_ROOT_STYLE = { width: 360 };

const meta: Meta<typeof FolderPickerInput> = {
  title: "UI Components/FolderPickerInput",
  component: FolderPickerInput,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={STORY_ROOT_STYLE}>
        <FormField label="Project location" message="A new project folder will be created here.">
          <Story />
        </FormField>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof FolderPickerInput>;

export const Empty: Story = { args: { large: true, required: true } };
export const Selected: Story = { args: { large: true, required: true, value: "Scores" } };
