import { expect, it } from "vitest";
import * as Y from "yjs";
import { remapScoreLyricExtenderTargets, type NoteEvent } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { LOCAL_WRITE_ORIGIN, MnxYjsBridge } from "../MnxYjsBridge";

it("replicates final-fragment references atomically and restores hidden and visible intent on undo", () => {
  const original = parseMnx({
    mnx: { version: 1, support: { useLyricExtenders: true } },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    id: "source",
                    duration: { base: "half" },
                    notes: [{ id: "source-note", pitch: { step: "C", octave: 4 } }],
                    lyrics: {
                      lines: {
                        verse: { text: "Ah", extender: { id: "span", target: "source", _c: "keep" } },
                        hidden: {
                          text: "Hidden",
                          extender: { show: false, target: "source", _x: { test: { keep: true } } },
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const changed = structuredClone(original);
  const content = changed.parts[0]!.measures[0]!.sequences[0]!.content;
  const source = content[0] as NoteEvent;
  source.duration = { base: "quarter" };
  content.push({
    type: "event",
    id: "final",
    duration: { base: "quarter" },
    notes: [{ id: "final-note", pitch: { step: "C", octave: 4 } }],
  });
  remapScoreLyricExtenderTargets(changed, new Map([["source", "final"]]));
  const bridge = new MnxYjsBridge();
  const peer = new MnxYjsBridge();
  bridge.setMnxJson(JSON.stringify(serializeMnx(original)));
  Y.applyUpdate(peer.doc, Y.encodeStateAsUpdate(bridge.doc));
  const undo = new Y.UndoManager(bridge.doc.getMap("score"), { trackedOrigins: new Set([LOCAL_WRITE_ORIGIN]) });
  const received: string[] = [];
  peer.onRemoteUpdate((mnx) => received.push(mnx));
  bridge.doc.on("update", (update: Uint8Array) => Y.applyUpdate(peer.doc, update, "network"));
  bridge.setMnxJson(JSON.stringify(serializeMnx(changed)));
  expect(received).toHaveLength(1);
  expect(parseMnx(JSON.parse(peer.getMnxJson())).parts).toEqual(changed.parts);
  undo.undo();
  expect(parseMnx(JSON.parse(peer.getMnxJson())).parts).toEqual(original.parts);
  undo.redo();
  expect(parseMnx(JSON.parse(peer.getMnxJson())).parts).toEqual(changed.parts);
  undo.destroy();
  bridge.doc.destroy();
  peer.doc.destroy();
});
