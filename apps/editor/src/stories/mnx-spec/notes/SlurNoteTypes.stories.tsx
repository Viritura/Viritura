import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import {
  DottedNotes as dottedNotes,
  MixedDurations as mixedDurations,
  SlurEndOnDottedNote as slurEndOnDottedNote,
  SlurOverRest as slurOverRest,
  SlurWithChords as slurWithChords,
} from "./slurCases";

const meta: Meta = {
  title: "Engraving Behavior/Slurs & Ties/Note Interactions",
  component: ScorePreview,
};

export default meta;

export const SlurWithChords: StoryObj = slurWithChords;
export const DottedNotes: StoryObj = dottedNotes;
export const SlurEndOnDottedNote: StoryObj = slurEndOnDottedNote;
export const MixedDurations: StoryObj = mixedDurations;
export const SlurOverRest: StoryObj = slurOverRest;
