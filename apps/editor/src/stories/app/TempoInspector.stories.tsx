import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "@viritura/ui";
import { withTempoSwing, withTempoText, type Tempo, type ResolvedTempoSwing } from "@viritura/core";
import { TempoSection } from "../../components/inspector/TempoSection";

const meta: Meta = {
  title: "App/Inspectors/Tempo",
  component: TempoSection,
};
export default meta;

const PREVIEW_STYLE: CSSProperties = { height: "42rem", maxWidth: "100%" };
const METRONOME: Tempo = { bpm: 90, value: { base: "quarter" }, text: [{ text: "Allegro" }] };

function TempoInspectorPreview({
  initialTempo,
  inherited,
  width = 360,
}: {
  initialTempo: Tempo;
  inherited?: ResolvedTempoSwing;
  width?: number;
}) {
  const [tempo, setTempo] = useState<Tempo | null>(initialTempo);
  if (!tempo) return <p>Tempo instruction removed.</p>;
  return (
    <Panel
      side="right"
      width={width}
      style={PREVIEW_STYLE}
      title="Notation Properties"
      subtitle="Selected: tempo in bar 1"
      scrollBody
    >
      <TempoSection
        tempo={tempo}
        effectiveSwing={
          tempo.swing
            ? { swing: tempo.swing, source: { measureIndex: 0, tempoIndex: 0 } }
            : (inherited ?? { swing: { mode: "straight" } })
        }
        onSwingChange={(swing) => setTempo(withTempoSwing(tempo, swing))}
        onBpmChange={(bpm) => {
          if (tempo.bpm !== undefined) setTempo({ ...tempo, bpm });
        }}
        onValueBaseChange={(base) => {
          if (tempo.value) setTempo({ ...tempo, value: { ...tempo.value, base } });
        }}
        onDotsChange={(dots) => {
          if (tempo.value) setTempo({ ...tempo, value: { ...tempo.value, dots } });
        }}
        onTextChange={(text) => setTempo(withTempoText(tempo, text))}
        onShowTextChange={(showText) => setTempo({ ...tempo, showText })}
        onShowMetronomeChange={(showMetronomeMark) => setTempo({ ...tempo, showMetronomeMark })}
      />
    </Panel>
  );
}

export const SwingControls: StoryObj = {
  render: () => (
    <TempoInspectorPreview
      initialTempo={{ ...METRONOME, swing: { mode: "swing", subdivision: "16th", ratio: [3, 2] } }}
    />
  ),
};

export const InheritedSwing: StoryObj = {
  render: () => (
    <TempoInspectorPreview
      initialTempo={METRONOME}
      inherited={{
        swing: { mode: "swing", subdivision: "16th", ratio: [3, 2] },
        source: { measureIndex: 0, tempoIndex: 1 },
      }}
    />
  ),
};

export const Straight: StoryObj = {
  render: () => <TempoInspectorPreview initialTempo={{ ...METRONOME, swing: { mode: "straight" } }} />,
};

export const CustomRatio: StoryObj = {
  render: () => (
    <TempoInspectorPreview
      initialTempo={{ ...METRONOME, swing: { mode: "swing", subdivision: "eighth", ratio: [7, 4] } }}
    />
  ),
};

export const SwingOnly: StoryObj = {
  render: () => (
    <TempoInspectorPreview
      initialTempo={{ text: [{ text: "Swing" }], swing: { mode: "swing", subdivision: "16th", ratio: [3, 2] } }}
    />
  ),
};

export const NarrowPanel: StoryObj = {
  render: () => (
    <TempoInspectorPreview
      width={280}
      initialTempo={{ ...METRONOME, swing: { mode: "swing", subdivision: "16th", ratio: [3, 2] } }}
    />
  ),
};
