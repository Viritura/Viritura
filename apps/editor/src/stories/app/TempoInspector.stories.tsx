import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { MetronomicTempo } from "@viritura/core";
import { TempoSection } from "../../components/inspector/TempoSection";

const meta: Meta = {
  title: "App/Inspectors/Tempo",
  component: TempoSection,
};
export default meta;

export const SwingControls: StoryObj = {
  render: function TempoInspectorStory() {
    const [tempo, setTempo] = useState<MetronomicTempo>({
      bpm: 90,
      value: { base: "quarter" },
      text: [{ text: "J-Pop" }],
      swing: { mode: "swing", subdivision: "16th", ratio: [3, 2] },
    });
    return (
      <TempoSection
        tempo={tempo}
        effectiveSwing={{
          swing: tempo.swing ?? { mode: "straight" },
          source: tempo.swing ? { measureIndex: 0, tempoIndex: 0 } : undefined,
        }}
        onSwingChange={(swing) => setTempo({ ...tempo, swing })}
        onBpmChange={(bpm) => setTempo({ ...tempo, bpm })}
        onValueBaseChange={(base) => setTempo({ ...tempo, value: { ...tempo.value, base } })}
        onDotsChange={(dots) => setTempo({ ...tempo, value: { ...tempo.value, dots } })}
        onTextChange={(text) => setTempo({ ...tempo, text })}
        onShowTextChange={(showText) => setTempo({ ...tempo, showText })}
        onShowMetronomeChange={(showMetronomeMark) => setTempo({ ...tempo, showMetronomeMark })}
      />
    );
  },
};
