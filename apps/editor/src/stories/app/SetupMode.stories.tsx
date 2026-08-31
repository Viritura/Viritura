/**
 * Storybook story for the Setup-mode panel.
 *
 * Setup mode consolidates what used to be split between the New Score wizard
 * (a modal editing a throwaway `Player[]` draft) and Write mode's Musicians
 * tab. In the app it sits beside the shared `ScoreCanvas`, so each edit
 * re-engraves the score live; this story exercises the panel itself against a
 * real document store, with instrument mutations wired up so the ensemble
 * templates and catalog picker actually work.
 *
 * The `Empty` story is what a freshly created score shows: no instruments, and
 * the ensemble templates offered as the way in.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseMnx } from "@viritura/format";
import type { Score } from "@viritura/core";
import { SetupPanel } from "../../components/modes/setup/SetupPanel";
import { DocumentProvider, useDocumentActions, useDocumentStore } from "../../store/DocumentContext";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../../score/ScoreBuilder";
import { expandTemplate } from "../../score/InstrumentCatalog";
import { addInstrumentToScore, removeInstrumentFromScore } from "../../score/ScoreMutations";

const FRAME_STYLE: CSSProperties = {
  width: 360,
  height: 640,
  display: "flex",
  flexDirection: "column",
  background: "var(--surface)",
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "var(--elevation-1)",
};

/** Seeds the document store, then renders the panel against it. */
function SetupPanelHarness({ templateId }: { readonly templateId?: string }) {
  const { loadScore } = useDocumentActions();
  const score = useDocumentStore((s) => s.score);
  const updateScore = useDocumentStore((s) => s.updateScore);
  const [selectedScoreIndex, setSelectedScoreIndex] = useState(0);

  useEffect(() => {
    const players = templateId ? expandTemplate(templateId) : [];
    const json = buildBlankScore({ ...DEFAULT_NEW_SCORE_SETTINGS, title: "Setup Demo", players });
    loadScore(parseMnx(JSON.parse(json)));
  }, [templateId, loadScore]);

  const handleAddInstrument = useCallback(
    (instrumentId: string) => {
      if (score) updateScore(addInstrumentToScore(score, instrumentId));
    },
    [score, updateScore],
  );

  const handleAddEnsemble = useCallback(
    (id: string) => {
      if (!score) return;
      updateScore(expandTemplate(id).reduce<Score>((acc, p) => addInstrumentToScore(acc, p.instrumentId), score));
    },
    [score, updateScore],
  );

  const handleRemoveInstrument = useCallback(
    (partId: string) => {
      if (score) updateScore(removeInstrumentFromScore(score, partId));
    },
    [score, updateScore],
  );

  return (
    <div style={FRAME_STYLE}>
      <SetupPanel
        scoreDefinitions={score?.scores ?? []}
        selectedScoreIndex={selectedScoreIndex}
        onSelectScore={setSelectedScoreIndex}
        onAddInstrument={handleAddInstrument}
        onAddEnsemble={handleAddEnsemble}
        onRemoveInstrument={handleRemoveInstrument}
      />
    </div>
  );
}

function SetupPanelStory({ templateId }: { readonly templateId?: string }) {
  return (
    <DocumentProvider>
      <SetupPanelHarness templateId={templateId} />
    </DocumentProvider>
  );
}

const meta: Meta<typeof SetupPanelStory> = {
  title: "App/Setup Mode",
  component: SetupPanelStory,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof SetupPanelStory>;

/** A fresh score: no instruments, ensemble templates offered as the way in. */
export const Empty: Story = {
  render: () => <SetupPanelStory />,
};

/** A populated score — roster, layouts, and opening signatures are all live. */
export const StringQuartet: Story = {
  render: () => <SetupPanelStory templateId="string-quartet" />,
};

/** A larger ensemble, to exercise the layout tree and roster scrolling. */
export const ConcertBand: Story = {
  render: () => <SetupPanelStory templateId="concert-band" />,
};
