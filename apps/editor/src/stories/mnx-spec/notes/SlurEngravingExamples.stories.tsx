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
export const MixedStemsAcrossBarline: StoryObj = {
  name: "Mixed stems across a barline",
  render: () => {
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 2, unit: 4 } }, {}] },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    { duration: { base: "quarter" }, rest: {} },
                    {
                      id: "src",
                      duration: { base: "eighth" },
                      stemDirection: "up",
                      notes: [{ pitch: { step: "G", octave: 4 } }],
                      slurs: [{ target: "tgt" }],
                    },
                    { duration: { base: "eighth" }, stemDirection: "up", notes: [{ pitch: { step: "B", octave: 4 } }] },
                  ],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [
                    {
                      id: "tgt",
                      duration: { base: "quarter", dots: 1 },
                      stemDirection: "down",
                      notes: [{ pitch: { step: "C", octave: 5 } }],
                    },
                    { duration: { base: "eighth" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    return <ScorePreview mnxJson={JSON.stringify(mnx)} />;
  },
};
export const SlurEndsOnTiedNote: StoryObj = slurEndsOnTiedNote;
export const SlurEndsOnIncomingTie: StoryObj = slurEndsOnIncomingTie;
export const SteepSlurOverTie: StoryObj = {
  name: "Steep slur over a tied note",
  render: () => {
    const note = (step: string, octave: number, base = "16th") => ({
      duration: { base },
      notes: [{ pitch: { step, octave } }],
    });
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    note("G", 5),
                    note("A", 5, "eighth"),
                    note("G", 5),
                    note("A", 5, "eighth"),
                    { ...note("G", 5), id: "src", slurs: [{ target: "tied" }] },
                    {
                      id: "tied",
                      duration: { base: "16th" },
                      notes: [{ id: "n1", pitch: { step: "D", octave: 6 }, ties: [{ target: "n2" }] }],
                    },
                    {
                      id: "continuation",
                      duration: { base: "16th" },
                      notes: [{ id: "n2", pitch: { step: "D", octave: 6 } }],
                    },
                    note("G", 5),
                    note("A", 5),
                    note("B", 5),
                    note("A", 5, "eighth"),
                    note("G", 5),
                    note("G", 5),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    return <ScorePreview mnxJson={JSON.stringify(mnx)} />;
  },
};
export const ClusterChordSlur: StoryObj = clusterChordSlur;
export const ApexOnStaffSpace: StoryObj = apexOnStaffSpace;
export const LongSlurPlateau: StoryObj = longSlurPlateau;
export const SymmetricSlur: StoryObj = symmetricSlur;
