import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { patch, type Score } from "@viritura/core";
import { serializeMnx } from "@viritura/format";
import { createDocumentStore, SHARED_SETLIST_READ_ONLY } from "./documentStore";

const score = (): Score => ({ mnx: { version: 1 }, global: { measures: [{}] }, parts: [] });

function readOnlyStore() {
  const store = createDocumentStore();
  store.getState().loadScore(score(), "shared.mnx");
  store.getState().setReadOnly(SHARED_SETLIST_READ_ONLY);
  return store;
}

afterEach(() => vi.restoreAllMocks());

describe("read-only documents", () => {
  it("rejects every score mutation path and explains why", () => {
    const info = vi.spyOn(toast, "info");
    const store = readOnlyStore();
    const before = store.getState();

    store.getState().updateScore({ ...score(), global: { measures: [{}, {}] } });
    store.getState().commitPatches([patch.insertMeasures(0, [{}])]);
    store.getState().repairMeasures();
    expect(() => store.getState().commitDocument(JSON.stringify(serializeMnx(score())))).toThrow(
      SHARED_SETLIST_READ_ONLY,
    );

    const after = store.getState();
    expect(after.score).toBe(before.score);
    expect(after.workingScore).toBe(before.workingScore);
    expect(after.mnxJson).toBe(before.mnxJson);
    expect(after.scoreRevision).toBe(before.scoreRevision);
    expect(info).toHaveBeenCalledWith(SHARED_SETLIST_READ_ONLY, { id: "read-only-document" });
  });

  it("keeps the restriction across history restores and clears it when another document opens", () => {
    const store = readOnlyStore();
    store.getState().loadScore(score(), undefined, undefined, true);
    expect(store.getState().readOnlyReason).toBe(SHARED_SETLIST_READ_ONLY);

    store.getState().loadScore(score(), "local.mnx");
    expect(store.getState().readOnlyReason).toBeNull();

    store.getState().setReadOnly(SHARED_SETLIST_READ_ONLY);
    store.getState().newScore();
    expect(store.getState().readOnlyReason).toBeNull();
  });
});
