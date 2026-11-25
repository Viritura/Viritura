import { expect, it } from "vitest";
import * as Y from "yjs";
import { MnxYjsBridge } from "../MnxYjsBridge";
import { parseMnx } from "@viritura/format";

it("converges concurrent same-position fermatas to one deterministic identity and settings", () => {
  const a = new MnxYjsBridge();
  const b = new MnxYjsBridge();
  a.setMnxJson(
    JSON.stringify({
      mnx: { version: 1 },
      global: { measures: [{ _x: { viritura: { fermatas: [] } } }] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      duration: { base: "whole" },
                      rest: {},
                      fermata: { _x: { viritura: { globalFermataId: "z" } } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
  const stateA = Y.encodeStateVector(a.doc);
  const stateB = Y.encodeStateVector(b.doc);
  const array = (bridge: MnxYjsBridge) => {
    const global = bridge.doc.getMap("score").get("global") as Y.Map<unknown>;
    const measure = (global.get("measures") as Y.Array<Y.Map<unknown>>).get(0);
    const vendor = (measure.get("_x") as Y.Map<unknown>).get("viritura") as Y.Map<unknown>;
    return vendor.get("fermatas") as Y.Array<unknown>;
  };
  array(a).push([{ id: "z", position: { fraction: [1, 2] }, multiplier: 3 }]);
  array(b).push([{ id: "a", position: { fraction: [2, 4] }, multiplier: 1.5 }]);
  const updateA = Y.encodeStateAsUpdate(a.doc, stateA);
  const updateB = Y.encodeStateAsUpdate(b.doc, stateB);
  Y.applyUpdate(a.doc, updateB);
  Y.applyUpdate(b.doc, updateA);
  const read = (bridge: MnxYjsBridge) => parseMnx(JSON.parse(bridge.getMnxJson())).global.measures[0]!.fermatas;
  expect(read(a)).toEqual([{ id: "a", position: { fraction: [2, 4] }, multiplier: 1.5 }]);
  expect(read(b)).toEqual(read(a));
  a.doc.destroy();
  b.doc.destroy();
});
