interface Pitch {
  readonly step: string;
  readonly octave: number;
  readonly alter?: number;
}

function note(id: string, duration: string, pitch: Pitch, tieTarget?: string): object {
  return {
    id,
    duration: { base: duration },
    notes: [{ id: `${id}-note`, pitch, ...(tieTarget ? { ties: [{ target: tieTarget }] } : {}) }],
  };
}

export const mnxHeroSample = {
  mnx: { version: 1, support: { useBeams: true } },
  global: {
    measures: [{ time: { count: 4, unit: 4 }, barline: { type: "regular" } }, {}],
  },
  parts: [
    {
      id: "mnx-hub-sample",
      measures: [
        {
          clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
          beams: [{ events: ["sample-1", "sample-2", "sample-3", "sample-4"] }, { events: ["sample-6", "sample-7"] }],
          sequences: [
            {
              content: [
                note("sample-1", "eighth", { step: "D", octave: 5 }),
                note("sample-2", "eighth", { step: "E", octave: 5 }),
                note("sample-3", "eighth", { step: "F", octave: 5 }),
                note("sample-4", "eighth", { step: "G", octave: 5 }),
                note("sample-5", "quarter", { step: "E", octave: 5 }),
                note("sample-6", "eighth", { step: "C", octave: 5 }),
                note("sample-7", "eighth", { step: "D", octave: 5 }, "sample-8-note"),
              ],
            },
          ],
        },
        {
          sequences: [{ content: [note("sample-8", "whole", { step: "D", octave: 5 })] }],
        },
      ],
    },
  ],
};
