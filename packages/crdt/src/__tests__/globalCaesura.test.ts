import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyPatchesToScore, patch, type Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { LOCAL_WRITE_ORIGIN, MnxYjsBridge } from "../MnxYjsBridge";

describe("global caesura collaboration and undo", () => {
  it("syncs one global marking and restores it with Yjs undo/redo without changing event marks", () => {
    const initial: Score = {
      mnx: { version: 1 },
      global: { measures: [{ caesura: { id: "shared", _c: "retained" } }] },
      parts: [
        {
          id: "piano",
          staves: 2,
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "event",
                      duration: { base: "whole" },
                      rest: {},
                      markings: { caesura: { style: "short" } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const a = new MnxYjsBridge();
    const b = new MnxYjsBridge();
    a.doc.on("update", (update: Uint8Array) => Y.applyUpdate(b.doc, update, "remote"));
    a.setMnxJson(JSON.stringify(serializeMnx(initial)));
    const undo = new Y.UndoManager(a.doc.getMap("score"), { trackedOrigins: new Set([LOCAL_WRITE_ORIGIN]) });
    const edited = applyPatchesToScore(initial, [
      patch.setGlobalMeasureField(0, {
        field: "caesura",
        value: { ...initial.global.measures[0]!.caesura, style: "curved", marks: 1 },
      }),
    ]);
    a.setMnxJson(JSON.stringify(serializeMnx(edited)));
    const read = () => parseMnx(JSON.parse(b.getMnxJson()));
    expect(read().global.measures[0]!.caesura).toEqual({ id: "shared", _c: "retained", style: "curved", marks: 1 });
    undo.stopCapturing();
    const removed = applyPatchesToScore(edited, [
      patch.setGlobalMeasureField(0, { field: "caesura", value: undefined }),
    ]);
    a.setMnxJson(JSON.stringify(serializeMnx(removed)));
    expect(read().global.measures[0]!.caesura).toBeUndefined();
    undo.undo();
    expect(read().global.measures[0]!.caesura).toEqual(edited.global.measures[0]!.caesura);
    undo.undo();
    expect(read().global.measures[0]!.caesura).toEqual(initial.global.measures[0]!.caesura);
    undo.redo();
    expect(read().global.measures[0]!.caesura).toEqual(edited.global.measures[0]!.caesura);
    expect(read().parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      markings: { caesura: { style: "short" } },
    });
    undo.destroy();
    a.doc.destroy();
    b.doc.destroy();
  });
});
