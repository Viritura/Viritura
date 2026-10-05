import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  TranspositionPitchFields,
  type TranspositionPitchFieldsProps,
} from "../../components/parts/transpositionPitch";

const FRAME_STYLE: CSSProperties = { width: 360, padding: 16, background: "var(--surface)" };

function TranspositionPitchStory(props: TranspositionPitchFieldsProps) {
  const [interval, setInterval] = useState({ halfSteps: props.halfSteps, staffDistance: props.staffDistance });
  return (
    <div style={FRAME_STYLE}>
      <TranspositionPitchFields
        instrumentId={props.instrumentId}
        {...interval}
        onChange={(halfSteps, staffDistance) => setInterval({ halfSteps, staffDistance })}
      />
    </div>
  );
}

const meta: Meta<typeof TranspositionPitchStory> = {
  title: "App/Setup Mode/Transposition Pitch",
  component: TranspositionPitchStory,
  parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof TranspositionPitchStory>;

export const HornInF: Story = {
  args: { instrumentId: "brass.french-horn", halfSteps: 7, staffDistance: 4 },
};
export const HornBFlatAlto: Story = {
  args: { instrumentId: "brass.french-horn", halfSteps: 2, staffDistance: 1 },
};
export const HornBFlatBasso: Story = {
  args: { instrumentId: "brass.french-horn", halfSteps: 14, staffDistance: 8 },
};
export const EFlatPiccoloClarinet: Story = {
  args: { instrumentId: "wind.reed.clarinet.eflat", halfSteps: -3, staffDistance: -2 },
};
export const EFlatAltoClarinetNotation: Story = {
  args: { instrumentId: "wind.reed.clarinet.eflat", halfSteps: 9, staffDistance: 5 },
};
export const EnharmonicCustomPitch: Story = {
  args: { halfSteps: 1, staffDistance: 0 },
};
export const UnusualExistingInterval: Story = {
  args: { halfSteps: -3, staffDistance: 0 },
};
