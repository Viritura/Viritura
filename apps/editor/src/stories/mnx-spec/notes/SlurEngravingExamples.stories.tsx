import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import {
  ApexOnStaffSpace as apexOnStaffSpace,
  ClusterChordSlur as clusterChordSlur,
  LongSlurPlateau as longSlurPlateau,
  MixedStemDirections as mixedStemDirections,
  OppositeOuterStems as oppositeOuterStems,
  SlurEndsOnIncomingTie as slurEndsOnIncomingTie,
  SlurEndsOnTiedNote as slurEndsOnTiedNote,
  SlurOverBeamedGroup as slurOverBeamedGroup,
  SymmetricSlur as symmetricSlur,
} from "./slurCases";

const meta: Meta = {
  title: "Engraving Behavior/Slurs & Ties/Beam, Tie and Chord Interactions",
  component: ScorePreview,
};

export default meta;

export const MixedStemDirections: StoryObj = mixedStemDirections;
export const OppositeOuterStems: StoryObj = oppositeOuterStems;
export const SlurOverBeamedGroup: StoryObj = slurOverBeamedGroup;
export const SlurEndsOnTiedNote: StoryObj = slurEndsOnTiedNote;
export const SlurEndsOnIncomingTie: StoryObj = slurEndsOnIncomingTie;
export const ClusterChordSlur: StoryObj = clusterChordSlur;
export const ApexOnStaffSpace: StoryObj = apexOnStaffSpace;
export const LongSlurPlateau: StoryObj = longSlurPlateau;
export const SymmetricSlur: StoryObj = symmetricSlur;
