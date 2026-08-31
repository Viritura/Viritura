import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText, FileCode2, FileMusic } from "lucide-react";
import { Radio, RadioGroup } from "./Radio";

const COL_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, minWidth: 280 };

const meta: Meta<typeof RadioGroup> = {
  title: "UI Components/Radio",
  component: RadioGroup,
  // Radio is used only in NewScoreDialog step flows (Tier-4 modal).
  parameters: { layout: "centered", surface: "modal" },
};
export default meta;

type Story = StoryObj<typeof RadioGroup>;

export const Compact: Story = {
  render: () => {
    const [value, setValue] = useState("a");
    return (
      <RadioGroup value={value} onChange={setValue}>
        <Radio value="a" label="Option A" />
        <Radio value="b" label="Option B" />
        <Radio value="c" label="Option C" />
      </RadioGroup>
    );
  },
};

export const InlineCompact: Story = {
  render: () => {
    const [value, setValue] = useState("major");
    return (
      <RadioGroup value={value} onChange={setValue} layout="inline">
        <Radio value="major" label="Major" />
        <Radio value="minor" label="Minor" />
        <Radio value="modal" label="Modal" />
      </RadioGroup>
    );
  },
};

export const Cards: Story = {
  render: () => {
    const [value, setValue] = useState("project");
    return (
      <div style={COL_STYLE}>
        <RadioGroup value={value} onChange={setValue}>
          <Radio
            value="project"
            variant="card"
            label="Project folder (recommended)"
            description="Pick a folder. Viritura keeps version history so you can review and restore changes."
          />
          <Radio
            value="standalone"
            variant="card"
            label="Standalone .mnx file"
            description="Single file. No version history. You can upgrade to a project later."
          />
        </RadioGroup>
      </div>
    );
  },
};

export const CardsWithIcons: Story = {
  render: () => {
    const [value, setValue] = useState("pdf");
    return (
      <div style={COL_STYLE}>
        <RadioGroup value={value} onChange={setValue}>
          <Radio
            value="pdf"
            variant="card"
            icon={<FileText size={16} />}
            label="PDF"
            description="Publication-quality print"
          />
          <Radio
            value="musicxml"
            variant="card"
            icon={<FileCode2 size={16} />}
            label="MusicXML"
            description="Industry-standard interchange format"
          />
          <Radio
            value="midi"
            variant="card"
            icon={<FileMusic size={16} />}
            label="MIDI"
            description="For DAWs and external sequencers"
            disabled
          />
        </RadioGroup>
      </div>
    );
  },
};
