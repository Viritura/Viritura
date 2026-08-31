import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import {
  AllInSpaces as allInSpaces,
  AllOnStaffLines as allOnStaffLines,
  EightNoteSlur as eightNoteSlur,
  FourNoteSlur as fourNoteSlur,
  HighLedgerLines as highLedgerLines,
  LowLedgerLines as lowLedgerLines,
  SixteenNoteSlur as sixteenNoteSlur,
  ThreeNoteSlur as threeNoteSlur,
  TightSpacing as tightSpacing,
  TwoNoteSlur as twoNoteSlur,
} from "./slurCases";

const meta: Meta = {
  title: "Engraving Behavior/Slurs & Ties/Span and Register",
  component: ScorePreview,
};

export default meta;

export const TwoNoteSlur: StoryObj = twoNoteSlur;
export const ThreeNoteSlur: StoryObj = threeNoteSlur;
export const FourNoteSlur: StoryObj = fourNoteSlur;
export const EightNoteSlur: StoryObj = eightNoteSlur;
export const SixteenNoteSlur: StoryObj = sixteenNoteSlur;
export const AllOnStaffLines: StoryObj = allOnStaffLines;
export const AllInSpaces: StoryObj = allInSpaces;
export const HighLedgerLines: StoryObj = highLedgerLines;
export const LowLedgerLines: StoryObj = lowLedgerLines;
export const TightSpacing: StoryObj = tightSpacing;
