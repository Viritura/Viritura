import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Viritura Extensions/Meter & Layout/Part Instrument Headers",
  component: ScorePreview,
};
export default meta;

function clarinetPartScore(authored = false, custom = false, cover = false): string {
  const count = cover ? 24 : 4;
  return JSON.stringify({
    mnx: { version: 1 },
    _x: { viritura: { metadata: { title: "Clarinet study", composer: "Example composer" } } },
    global: {
      measures: Array.from({ length: count }, (_, index) => ({
        id: `m${index + 1}`,
        ...(index === 0 ? { time: { count: 4, unit: 4 } } : {}),
      })),
    },
    parts: ["cl1", "cl2"].map((id) => ({
      id,
      name: "Clarinet",
      shortName: "Cl.",
      transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
      measures: Array.from({ length: count }, (_, index) => ({
        ...(index === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }] } : {}),
        sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }] }],
        ...(index === 1
          ? {
              _x: {
                viritura: {
                  instrumentChanges: [{ transposition: { interval: { halfSteps: 3, staffDistance: 2 } } }],
                },
              },
            }
          : {}),
      })),
    })),
    layouts: [{ id: "part", content: [{ type: "staff", sources: [{ part: "cl1" }], labelref: "name" }] }],
    scores: [
      {
        name: custom ? "Reeds player" : "Clarinet in B\u266d 1",
        layout: "part",
        useWritten: true,
        ...(authored ? { pages: [{ systems: [{ measure: "m1" }, { measure: "m3" }] }] } : {}),
        _x: {
          viritura: {
            pageSetup: {
              width: 120,
              height: 100,
              orientation: "portrait",
              margins: { top: 10, right: 10, bottom: 10, left: 10 },
              spatiumMm: 1,
              pageTurns: { enabled: cover, titlePage: cover ? "always" : "never" },
            },
          },
        },
      },
    ],
  });
}

export const AutomaticFirstPage: StoryObj = {
  render: () => <ScorePreview mnxJson={clarinetPartScore()} viewMode="page" />,
};

export const AuthoredSystems: StoryObj = {
  render: () => <ScorePreview mnxJson={clarinetPartScore(true)} viewMode="page" />,
};

export const CustomScoreTitle: StoryObj = {
  render: () => <ScorePreview mnxJson={clarinetPartScore(false, true)} viewMode="page" />,
};

export const DedicatedTitlePage: StoryObj = {
  render: () => <ScorePreview mnxJson={clarinetPartScore(false, false, true)} viewMode="spread" />,
};

export const ActiveSystemStaffLabels: StoryObj = {
  render: () => {
    const score = JSON.parse(clarinetPartScore(true)) as {
      scores: { name: string; _x: { viritura: { pageSetup: unknown; instrumentNameDisplay?: unknown } } }[];
      layouts: { content: unknown[] }[];
    };
    score.scores[0]!.name = "Score";
    score.scores[0]!._x.viritura.instrumentNameDisplay = { firstSystem: "full", subsequentSystems: "short" };
    score.layouts[0]!.content.push({ type: "staff", sources: [{ part: "cl2" }], labelref: "name" });
    return <ScorePreview mnxJson={JSON.stringify(score)} viewMode="page" />;
  },
};
