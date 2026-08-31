/**
 * Integration test: ensure the new lazy-description history wiring doesn't
 * break the copy/paste flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { HistoryProvider } from "../HistoryContext";
import { useHistoryStore, type HistoryStoreState } from "../historyStore";
import type { ReactNode } from "react";

function wrapper(initialMnx: string) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <HistoryProvider initialMnxJson={initialMnx}>{children}</HistoryProvider>
  );
  Wrapper.displayName = "HistoryProviderTestWrapper";
  return Wrapper;
}

const minimalMnx = (note: string) =>
  JSON.stringify({
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "P1",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: note, octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

describe("HistoryContext lazy description integration", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("pushState succeeds and produces a usable history entry even before microtask resolves description", async () => {
    const { result } = renderHook(
      () => ({
        push: useHistoryStore((s: HistoryStoreState) => s.pushState),
        entries: useHistoryStore((s: HistoryStoreState) => s.entries),
      }),
      { wrapper: wrapper(minimalMnx("C")) },
    );

    act(() => {
      result.current.push(minimalMnx("D"), "Edit", null);
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[1]?.mnxJson).toBe(minimalMnx("D"));
    // Description not yet resolved (microtask hasn't run yet inside act)
  });

  it("microtask description resolution does not throw on valid MNX", async () => {
    const { result } = renderHook(
      () => ({
        push: useHistoryStore((s: HistoryStoreState) => s.pushState),
        entries: useHistoryStore((s: HistoryStoreState) => s.entries),
      }),
      { wrapper: wrapper(minimalMnx("C")) },
    );

    act(() => {
      result.current.push(minimalMnx("D"), "Edit", null);
    });

    // Wait for microtask
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[1]?.descriptionResolved).toBe(true);
  });

  it("preloadDescriptions resolves all pending entries and bumps array reference", async () => {
    const { result } = renderHook(
      () => ({
        push: useHistoryStore((s: HistoryStoreState) => s.pushState),
        preload: useHistoryStore((s: HistoryStoreState) => s.preloadDescriptions),
        entries: useHistoryStore((s: HistoryStoreState) => s.entries),
      }),
      { wrapper: wrapper(minimalMnx("C")) },
    );

    act(() => {
      result.current.push(minimalMnx("D"), "Edit", null);
      result.current.push(minimalMnx("E"), "Edit", null);
      result.current.push(minimalMnx("F"), "Edit", null);
    });

    const beforeRef = result.current.entries;

    act(() => {
      result.current.preload();
    });

    expect(result.current.entries).not.toBe(beforeRef); // reference bumped
    for (const entry of result.current.entries) {
      expect(entry.descriptionResolved).toBe(true);
    }
  });

  it("jumpTo moves currentIndex and triggers onRestore", async () => {
    const restored: string[] = [];
    const onRestore = (mnx: string) => {
      restored.push(mnx);
    };

    function Wrap({ children }: { children: ReactNode }) {
      return (
        <HistoryProvider initialMnxJson={minimalMnx("C")} onRestore={onRestore}>
          {children}
        </HistoryProvider>
      );
    }

    const { result } = renderHook(
      () => ({
        push: useHistoryStore((s: HistoryStoreState) => s.pushState),
        jumpTo: useHistoryStore((s: HistoryStoreState) => s.jumpTo),
        currentIndex: useHistoryStore((s: HistoryStoreState) => s.currentIndex),
      }),
      { wrapper: Wrap },
    );

    act(() => {
      result.current.push(minimalMnx("D"), "Edit", null);
      result.current.push(minimalMnx("E"), "Edit", null);
    });

    expect(result.current.currentIndex).toBe(2);

    act(() => {
      result.current.jumpTo(0);
    });

    expect(result.current.currentIndex).toBe(0);
    expect(restored).toEqual([minimalMnx("C")]);
  });

  it("multiple rapid pushStates from a paste-like burst don't lose entries", async () => {
    const { result } = renderHook(
      () => ({
        push: useHistoryStore((s: HistoryStoreState) => s.pushState),
        entries: useHistoryStore((s: HistoryStoreState) => s.entries),
      }),
      { wrapper: wrapper(minimalMnx("C")) },
    );

    act(() => {
      // Simulate paste triggering several state updates rapidly
      for (let i = 0; i < 5; i++) {
        result.current.push(minimalMnx(["D", "E", "F", "G", "A"][i]!), "Edit", null);
      }
    });

    expect(result.current.entries).toHaveLength(6);

    // Drain microtasks
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // All but the initial entry should now have resolved descriptions
    expect(result.current.entries[5]?.descriptionResolved).toBe(true);
  });
});
