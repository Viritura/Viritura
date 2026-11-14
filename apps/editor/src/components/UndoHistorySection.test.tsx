import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, vi, describe, expect, it } from "vitest";
import { UndoHistorySection } from "./UndoHistorySection";
import { HistoryStoreContext, createHistoryStore, MAX_HISTORY } from "../store/historyStore";

const rowRenderCount = vi.hoisted(() => ({ value: 0 }));

vi.mock("@viritura/ui", () => ({
  ListRow: ({ children }: { children: ReactNode }) => {
    rowRenderCount.value++;
    return <>{children}</>;
  },
}));

afterEach(() => {
  vi.useRealTimers();
});

describe("UndoHistorySection", () => {
  it("only rerenders the changed rows when the full stack evicts its oldest entry", () => {
    const store = createHistoryStore('{"v":0}', { current: undefined });
    for (let index = 1; index < MAX_HISTORY; index++) {
      store.getState().pushState(`{"v":${index}}`, `Change ${index}`);
    }

    const view = render(
      <HistoryStoreContext.Provider value={store}>
        <UndoHistorySection />
      </HistoryStoreContext.Provider>,
    );
    rowRenderCount.value = 0;

    act(() => {
      store.getState().pushState('{"v":256}', "Change 256");
    });

    expect(store.getState().entries).toHaveLength(MAX_HISTORY);
    expect(rowRenderCount.value).toBeLessThan(10);
    view.unmount();
  });

  it("resolves pending descriptions one per task and cancels work on unmount", () => {
    vi.useFakeTimers();
    const store = createHistoryStore('{"v":0}', { current: undefined });
    for (let index = 1; index <= 3; index++) {
      store.getState().pushState(`{"v":${index}}`, "Edit");
    }
    const resolve = vi.fn(store.getState().resolveDescription);
    store.setState({ resolveDescription: resolve });
    const view = render(
      <HistoryStoreContext.Provider value={store}>
        <UndoHistorySection />
      </HistoryStoreContext.Provider>,
    );

    expect(resolve).not.toHaveBeenCalled();
    act(() => vi.runOnlyPendingTimers());
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenLastCalledWith(3);
    expect(store.getState().entries[2]?.descriptionResolved).toBe(false);

    act(() => vi.runOnlyPendingTimers());
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenLastCalledWith(2);

    view.unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("resolves the right entry when the full stack shifts before its timer runs", () => {
    vi.useFakeTimers();
    const store = createHistoryStore('{"v":0}', { current: undefined });
    for (let index = 1; index < MAX_HISTORY; index++) {
      store.getState().pushState(`{"v":${index}}`, "Edit");
    }
    const view = render(
      <HistoryStoreContext.Provider value={store}>
        <UndoHistorySection />
      </HistoryStoreContext.Provider>,
    );

    act(() => store.getState().pushState('{"v":256}', "Edit"));
    const newestId = store.getState().entries.at(-1)?.id;
    act(() => vi.runOnlyPendingTimers());

    expect(store.getState().entries.at(-1)).toMatchObject({ id: newestId, descriptionResolved: true });
    expect(store.getState().entries.at(-2)?.descriptionResolved).toBe(false);
    view.unmount();
  });
});
