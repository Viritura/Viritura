import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEFAULT_PART_PAGE_SETUP, type Score } from "@viritura/core";
import { Select } from "@viritura/ui";
import { BreakToolbar } from "../../../components/modes/engrave/BreakToolbar";
import { TitlePageControl } from "../../../components/modes/engrave/TitlePageControl";
import { WorkspaceToolbar, WorkspaceToolbarGroup } from "../../../components/WorkspaceToolbar";
import { DocumentProvider, useDocumentStore, useDocumentStoreApi } from "../../../store/DocumentContext";

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{}] },
  parts: [{ id: "p", name: "Flute", measures: [{ sequences: [] }] }],
  scores: [
    { name: "Full score", pageSetupRole: "score" },
    { name: "Flute 1", pageSetupRole: "part" },
    { name: "Flute 2", pageSetupRole: "part" },
  ],
  pageSetupDefaults: {
    part: {
      ...DEFAULT_PART_PAGE_SETUP,
      width: 215.9,
      height: 279.4,
      pageTurns: { enabled: true, preset: "professional" },
    },
  },
};

function PartTitlePageToolbar() {
  const [index, setIndex] = useState(1);
  const store = useDocumentStoreApi();
  const score = useDocumentStore((state) => state.score);
  useEffect(() => store.getState().loadScore(SCORE), [store]);
  return (
    <div>
      <WorkspaceToolbar
        left={
          <Select
            aria-label="Score or part"
            value={String(index)}
            options={SCORE.scores!.map((definition, index) => ({
              value: String(index),
              label: definition.name!,
            }))}
            onValueChange={(value) => setIndex(Number(value))}
          />
        }
        center={
          <WorkspaceToolbarGroup label="Engrave layout">
            <BreakToolbar selected={false} kind={null} onSetKind={() => {}} />
            <TitlePageControl scoreIndex={index} />
          </WorkspaceToolbarGroup>
        }
      />
      <p>Each part can let the planner decide, require a title page, or exclude one.</p>
      <p>On and Off replan page turns with that title-page constraint.</p>
      <p>Changing this choice does not add geometry or break overrides. Switch parts to compare their settings.</p>
      <pre>{JSON.stringify(score?.scores?.[index]?.pageSetup ?? {}, null, 2)}</pre>
    </div>
  );
}

function TitlePageStory() {
  return (
    <DocumentProvider>
      <PartTitlePageToolbar />
    </DocumentProvider>
  );
}

const meta: Meta<typeof TitlePageStory> = {
  title: "App/Engrave Mode/Part Title Page",
  component: TitlePageStory,
};
export default meta;
export const PerPartOverride: StoryObj<typeof meta> = {};
