import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsRow } from "./SettingsRow";
import { Switch } from "../Switch/Switch";
import { Select } from "../Select/Select";
import { ButtonGroup } from "../ButtonGroup/ButtonGroup";
import { Slider } from "../Slider/Slider";

const PANEL: CSSProperties = { width: 520 };

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "midnight", label: "Midnight" },
];

const QUALITY = [
  { value: "draft", label: "Draft" },
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
];

const meta: Meta<typeof SettingsRow> = {
  title: "UI Components/SettingsRow",
  component: SettingsRow,
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof SettingsRow>;

/** Render-prop form: the label becomes a real `<label htmlFor>`. */
export const WithSwitch: Story = {
  render: () => {
    const [on, setOn] = useState(true);
    return (
      <div style={PANEL}>
        <SettingsRow
          label="Performance overlay"
          description="Show frame timing and layout cost while the score renders."
        >
          {({ controlId, descriptionId }) => (
            <Switch id={controlId} aria-describedby={descriptionId} checked={on} onCheckedChange={setOn} />
          )}
        </SettingsRow>
      </div>
    );
  },
};

export const WithoutDescription: Story = {
  render: () => {
    const [on, setOn] = useState(false);
    return (
      <div style={PANEL}>
        <SettingsRow label="Bypass tile cache">
          {({ controlId }) => <Switch id={controlId} checked={on} onCheckedChange={setOn} />}
        </SettingsRow>
      </div>
    );
  },
};

/** Composite controls use `aria-labelledby` instead of `htmlFor`. */
export const StackedControls: Story = {
  render: () => {
    const [theme, setTheme] = useState("light");
    const [quality, setQuality] = useState("standard");
    return (
      <div style={PANEL}>
        <SettingsRow
          layout="stacked"
          label="Theme"
          description="Applies immediately across the editor and the score canvas."
        >
          {({ labelId, descriptionId }) => (
            <ButtonGroup
              options={THEMES}
              value={theme}
              onChange={setTheme}
              ariaLabelledBy={labelId}
              ariaDescribedBy={descriptionId}
            />
          )}
        </SettingsRow>
        <SettingsRow layout="stacked" label="Export quality">
          {({ labelId }) => (
            <ButtonGroup options={QUALITY} value={quality} onChange={setQuality} ariaLabelledBy={labelId} />
          )}
        </SettingsRow>
      </div>
    );
  },
};

/** A full panel — the hairline rhythm is what makes it scannable. */
export const Panel: Story = {
  render: () => {
    const [vendor, setVendor] = useState(true);
    const [stems, setStems] = useState(false);
    const [metronome, setMetronome] = useState(true);
    const [engine, setEngine] = useState("sampler");
    const [wet, setWet] = useState(35);

    return (
      <div style={PANEL}>
        <SettingsRow
          label="Preserve vendor extensions"
          description="Keep Viritura-specific engraving data when importing MNX."
        >
          {({ controlId, descriptionId }) => (
            <Switch id={controlId} aria-describedby={descriptionId} checked={vendor} onCheckedChange={setVendor} />
          )}
        </SettingsRow>
        <SettingsRow
          label="Discard explicit stem directions"
          description="Let the engine choose stem directions instead of honouring the file."
        >
          {({ controlId, descriptionId }) => (
            <Switch id={controlId} aria-describedby={descriptionId} checked={stems} onCheckedChange={setStems} />
          )}
        </SettingsRow>
        <SettingsRow
          label="Hide metronome mark"
          description="Suppress the metronome mark when tempo text is already present."
        >
          {({ controlId, descriptionId }) => (
            <Switch
              id={controlId}
              aria-describedby={descriptionId}
              checked={metronome}
              onCheckedChange={setMetronome}
            />
          )}
        </SettingsRow>
        <SettingsRow label="Output mode" description="Offline rendering trades latency for fidelity.">
          {({ controlId, descriptionId }) => (
            <Select
              id={controlId}
              aria-describedby={descriptionId}
              value={engine}
              onValueChange={setEngine}
              options={[
                { value: "sampler", label: "Sampler" },
                { value: "offline", label: "Offline render" },
              ]}
            />
          )}
        </SettingsRow>
        <SettingsRow layout="stacked" label="Reverb wet level" description="Applied to every instrument by default.">
          {({ labelId, descriptionId }) => (
            <Slider
              value={wet}
              onChange={setWet}
              min={0}
              max={100}
              step={1}
              ariaLabelledBy={labelId}
              ariaDescribedBy={descriptionId}
            />
          )}
        </SettingsRow>
        <SettingsRow label="Bypass tile cache" description="Only useful when debugging the renderer." disabled>
          {({ controlId }) => <Switch id={controlId} checked={false} onCheckedChange={() => {}} disabled />}
        </SettingsRow>
      </div>
    );
  },
};
