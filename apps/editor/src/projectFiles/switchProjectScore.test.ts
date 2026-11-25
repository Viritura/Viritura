import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentStore } from "../store/documentStore";
import { useProjectStore } from "../store/projectStore";
import { useModalFlowStore } from "../store/modalFlowStore";
import { useLiveSessionStore } from "../live/liveSessionStore";
import { switchProjectScore } from "./switchProjectScore";

const dirty = vi.hoisted(() => ({ value: false }));
vi.mock("../store/documentStore", () => ({ hasUnsavedChanges: () => dirty.value }));
vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));

const documentState = { documentGeneration: 1, scoreRevision: "initial" };
const store = { getState: () => documentState } as unknown as DocumentStore;

function answerUnsavedPrompt(choice: "save" | "discard" | null) {
  const request = useModalFlowStore.getState().unsavedChanges;
  expect(request?.fileName).toBe("one.mnx");
  useModalFlowStore.getState()._setUnsavedChanges(null);
  request!.resolve(choice);
}

describe("switchProjectScore", () => {
  beforeEach(() => {
    dirty.value = false;
    documentState.documentGeneration = 1;
    documentState.scoreRevision = "initial";
    useLiveSessionStore.setState({ status: "idle" });
    useProjectStore.setState({
      activeScorePath: "one.mnx",
      projectScores: [
        { relativePath: "one.mnx", name: "one.mnx" },
        { relativePath: "set/two.mnx", name: "two.mnx" },
      ],
      committing: false,
    });
  });

  it("opens the target directly when the score is saved", async () => {
    const openProjectScore = vi.fn(async () => true);
    const save = vi.fn(async () => {});
    await expect(switchProjectScore({ store, relativePath: "set/two.mnx", openProjectScore, save })).resolves.toBe(
      true,
    );
    expect(openProjectScore).toHaveBeenCalledWith("set/two.mnx");
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the score open while a live session shares it", async () => {
    useLiveSessionStore.setState({ status: "active" });
    const openProjectScore = vi.fn(async () => true);
    await expect(
      switchProjectScore({ store, relativePath: "set/two.mnx", openProjectScore, save: vi.fn() }),
    ).resolves.toBe(false);
    expect(openProjectScore).not.toHaveBeenCalled();
  });

  it("cancels, discards or saves unsaved changes as chosen", async () => {
    dirty.value = true;
    const openProjectScore = vi.fn(async () => true);
    const save = vi.fn(async () => {
      dirty.value = false;
    });
    const args = { store, relativePath: "set/two.mnx", openProjectScore, save };

    const cancelled = switchProjectScore(args);
    answerUnsavedPrompt(null);
    await expect(cancelled).resolves.toBe(false);
    expect(openProjectScore).not.toHaveBeenCalled();

    const discarded = switchProjectScore(args);
    answerUnsavedPrompt("discard");
    await expect(discarded).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();

    const saved = switchProjectScore(args);
    answerUnsavedPrompt("save");
    await expect(saved).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(openProjectScore).toHaveBeenCalledTimes(2);
  });

  it("stays on the score when saving does not complete", async () => {
    dirty.value = true;
    const openProjectScore = vi.fn(async () => true);
    const pending = switchProjectScore({ store, relativePath: "set/two.mnx", openProjectScore, save: vi.fn() });
    answerUnsavedPrompt("save");
    await expect(pending).resolves.toBe(false);
    expect(openProjectScore).not.toHaveBeenCalled();
  });

  it("does not discard edits made while a background commit is finishing", async () => {
    useProjectStore.setState({ committing: true });
    const openProjectScore = vi.fn(async () => true);
    const pending = switchProjectScore({ store, relativePath: "set/two.mnx", openProjectScore, save: vi.fn() });
    documentState.scoreRevision = "edited";
    useProjectStore.setState({ committing: false });
    await expect(pending).resolves.toBe(false);
    expect(openProjectScore).not.toHaveBeenCalled();
  });

  it("does not switch if a live session starts while confirming unsaved changes", async () => {
    dirty.value = true;
    const openProjectScore = vi.fn(async () => true);
    const pending = switchProjectScore({ store, relativePath: "set/two.mnx", openProjectScore, save: vi.fn() });
    useLiveSessionStore.setState({ status: "active" });
    answerUnsavedPrompt("discard");
    await expect(pending).resolves.toBe(false);
    expect(openProjectScore).not.toHaveBeenCalled();
  });

  it("does not switch a different document after an unsaved-changes confirmation", async () => {
    dirty.value = true;
    const openProjectScore = vi.fn(async () => true);
    const pending = switchProjectScore({ store, relativePath: "set/two.mnx", openProjectScore, save: vi.fn() });
    documentState.documentGeneration++;
    answerUnsavedPrompt("discard");
    await expect(pending).resolves.toBe(false);
    expect(openProjectScore).not.toHaveBeenCalled();
  });

  it("does not discard edits made while confirming unsaved changes", async () => {
    dirty.value = true;
    const openProjectScore = vi.fn(async () => true);
    const pending = switchProjectScore({ store, relativePath: "set/two.mnx", openProjectScore, save: vi.fn() });
    documentState.scoreRevision = "edited";
    answerUnsavedPrompt("discard");
    await expect(pending).resolves.toBe(false);
    expect(openProjectScore).not.toHaveBeenCalled();
  });
});
