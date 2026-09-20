import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseChordSymbolText, resolvePartDisplayNames, type Score } from "@viritura/core";
import { Button, TooltipPrimitives } from "@viritura/ui";
import { MixerPanel } from "../../components/MixerPanel";
import { updatePartSoundSource } from "../../components/mixerSoundPicker";
import { buildPartGroups, extractFamilyGroups } from "../../store/familyGroups";
import { useMixerActions, useMixerPartSync } from "../../store/mixerStore";

const FRAME_STYLE: CSSProperties = {
  width: 420,
  height: 620,
  display: "flex",
  flexDirection: "column",
  background: "var(--surface)",
  borderRadius: 12,
  overflow: "hidden",
};
const TOOLBAR_STYLE: CSSProperties = { padding: 12 };
const PANEL_STYLE: CSSProperties = { flex: 1, minHeight: 0 };
const SAMPLE_SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }] },
  parts: [
    { id: "flute", name: "Flute", measures: [] },
    { id: "violin", name: "Violin", measures: [] },
  ],
};

function MixerStory({ unsupported = false }: { unsupported?: boolean }) {
  const [authoredScore, setScore] = useState(SAMPLE_SCORE);
  const [showChords, setShowChords] = useState(true);
  const actions = useMixerActions();
  const score = useMemo<Score>(
    () => ({
      ...authoredScore,
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            chordSymbols: showChords
              ? ["Cmaj7", "NC", unsupported ? "C7(b9)" : "G7"].map((text, index) =>
                  parseChordSymbolText(text, { fraction: [index, 4] }),
                )
              : [],
          },
        ],
      },
    }),
    [authoredScore, showChords, unsupported],
  );
  const parts = useMemo(
    () =>
      resolvePartDisplayNames(score.parts).map((part, index) => ({
        index,
        name: part.displayName,
      })),
    [score.parts],
  );

  useEffect(() => {
    actions.reset();
    return actions.reset;
  }, [actions]);
  useMixerPartSync(score.parts.length, showChords);
  useEffect(() => {
    const groups = extractFamilyGroups(score, parts);
    actions.syncGroups(
      groups.map((group) => group.label),
      buildPartGroups(parts.length + Number(showChords), groups),
    );
  }, [actions, score, parts, showChords]);

  return (
    <TooltipPrimitives.Provider delayDuration={0}>
      <div style={FRAME_STYLE}>
        <div style={TOOLBAR_STYLE}>
          <Button onClick={() => setShowChords((shown) => !shown)}>
            {showChords ? "Remove global chords" : "Restore global chords"}
          </Button>
        </div>
        <div style={PANEL_STYLE}>
          <MixerPanel
            parts={parts}
            score={score}
            onSoundSourceChange={(change) => setScore((previous) => updatePartSoundSource(previous, change))}
          />
        </div>
      </div>
    </TooltipPrimitives.Provider>
  );
}

const meta: Meta<typeof MixerStory> = {
  title: "App/Play/Mixer",
  component: MixerStory,
  parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof MixerStory>;

export const Default: Story = {};
export const UnsupportedChord: Story = { args: { unsupported: true } };
