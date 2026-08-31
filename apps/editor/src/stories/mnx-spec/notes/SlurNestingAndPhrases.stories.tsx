import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import {
  ChainedPairs as chainedPairs,
  MultipleSlursInMeasure as multipleSlursInMeasure,
  NestedSlurs as nestedSlurs,
  PhraseAcrossThreeMeasures as phraseAcrossThreeMeasures,
  PhraseSlurOverArticulationSlurs as phraseSlurOverArticulationSlurs,
} from "./slurCases";

const meta: Meta = {
  title: "Engraving Behavior/Slurs & Ties/Phrasing and Nesting",
  component: ScorePreview,
};

export default meta;

export const NestedSlurs: StoryObj = nestedSlurs;
export const ChainedPairs: StoryObj = chainedPairs;
export const MultipleSlursInMeasure: StoryObj = multipleSlursInMeasure;
export const PhraseAcrossThreeMeasures: StoryObj = phraseAcrossThreeMeasures;
export const PhraseSlurOverArticulationSlurs: StoryObj = phraseSlurOverArticulationSlurs;
