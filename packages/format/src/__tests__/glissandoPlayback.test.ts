import { describe, expect, it } from "vitest";
import { parseMnx, serializeMnx } from "../mnx";

function mnx(playbackType: string | undefined) {
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "source",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                    _x: { viritura: { glissandos: [{ target: "target", kind: "portamento", playbackType }] } },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("glissando playback persistence", () => {
  it.each(["chromatic", "diatonic", "pitch-bend", undefined])("round-trips %s", (type) => {
    const score = parseMnx(mnx(type));
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(event).toMatchObject({ glissandos: [{ kind: "portamento", ...(type ? { playbackType: type } : {}) }] });
    expect(parseMnx(serializeMnx(score))).toEqual(score);
  });

  it("rejects unsupported interpolation", () => {
    expect(() => parseMnx(mnx("continuous"))).toThrow();
  });
});
