import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import {
  AccentInTallSlurException as accentInTallSlurException,
  ArticulationInFirstClearSpace as articulationInFirstClearSpace,
  MixedArticulations as mixedArticulations,
  MixedStemSlurArticulations as mixedStemSlurArticulations,
  SamePitchRearticulation as samePitchRearticulation,
  TenutoCentersSlur as tenutoCentersSlur,
  WithAccent as withAccent,
  WithMarcato as withMarcato,
  WithStaccatissimoWedge as withStaccatissimoWedge,
  WithStaccato as withStaccato,
  WithTenuto as withTenuto,
} from "./slurCases";

const meta: Meta = {
  title: "Engraving Behavior/Slurs & Ties/Articulation Clearance",
  component: ScorePreview,
};

export default meta;

export const WithStaccato: StoryObj = withStaccato;
export const WithAccent: StoryObj = withAccent;
export const WithMarcato: StoryObj = withMarcato;
export const MixedArticulations: StoryObj = mixedArticulations;
export const WithTenuto: StoryObj = withTenuto;
export const WithStaccatissimoWedge: StoryObj = withStaccatissimoWedge;
export const MixedStemSlurArticulations: StoryObj = mixedStemSlurArticulations;
export const AccentInTallSlurException: StoryObj = accentInTallSlurException;
export const TenutoCentersSlur: StoryObj = tenutoCentersSlur;
export const SamePitchRearticulation: StoryObj = samePitchRearticulation;
export const ArticulationInFirstClearSpace: StoryObj = articulationInFirstClearSpace;
