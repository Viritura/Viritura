import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlayheadRect } from "@viritura/playback";
import type { ViewportState } from "../viewport";
import { useFollowPlayhead } from "../hooks/useFollowPlayhead";

const PLAYHEAD: PlayheadRect = { x: 350, yTop: 200, yBottom: 400 };

describe("useFollowPlayhead", () => {
  it("waits for a playing user-scroll commit before recapturing the horizontal anchor", () => {
    const viewportRef: { current: ViewportState } = {
      current: { scrollX: 0, scrollY: 0, zoom: 1 },
    };
    const containerRef = {
      current: { clientWidth: 1000, clientHeight: 600 } as HTMLDivElement,
    };
    const setScroll = vi.fn();
    const { result } = renderHook(() =>
      useFollowPlayhead({
        enabled: true,
        status: "playing",
        viewMode: "horizon",
        viewportRef,
        containerRef,
        setScroll,
      }),
    );

    act(() => result.current.onPlayheadRect(PLAYHEAD));
    expect(setScroll).not.toHaveBeenCalled();

    act(() => {
      result.current.onUserInteract();
      // The overlay's queued frame can run before React commits the wheel
      // update. It must neither consume the gesture nor run follow.
      result.current.onPlayheadRect(PLAYHEAD);
    });
    expect(setScroll).not.toHaveBeenCalled();

    viewportRef.current = { scrollX: 100, scrollY: 0, zoom: 1 };
    act(() => result.current.onPlayheadRect(PLAYHEAD));
    act(() => result.current.onPlayheadRect(PLAYHEAD));
    expect(setScroll).not.toHaveBeenCalled();

    act(() => result.current.onPlayheadRect({ ...PLAYHEAD, x: 360 }));
    expect(setScroll).toHaveBeenLastCalledWith(110, 0);
  });

  it.each(["paused", "stopped", "loading"] as const)("does not follow or reengage while %s", (status) => {
    const viewportRef = { current: { scrollX: 0, scrollY: 0, zoom: 1 } };
    const containerRef = { current: { clientWidth: 1000, clientHeight: 600 } as HTMLDivElement };
    const setScroll = vi.fn();
    const { result, rerender } = renderHook(
      ({ transportStatus }: { transportStatus: "playing" | typeof status }) =>
        useFollowPlayhead({
          enabled: true,
          status: transportStatus,
          viewMode: "horizon",
          viewportRef,
          containerRef,
          setScroll,
        }),
      { initialProps: { transportStatus: "playing" as const } },
    );
    act(() => result.current.onPlayheadRect(PLAYHEAD));
    act(() => {
      result.current.onUserInteract();
      viewportRef.current = { scrollX: 1000, scrollY: 0, zoom: 1 };
      result.current.onPlayheadRect(PLAYHEAD);
    });
    expect(result.current.detached).toBe(true);

    rerender({ transportStatus: status });
    expect(result.current.detached).toBe(false);
    act(() => {
      result.current.onPlayheadRect({ ...PLAYHEAD, x: 500 });
      result.current.onUserInteract();
      result.current.reengage();
    });
    expect(setScroll).not.toHaveBeenCalled();

    rerender({ transportStatus: "playing" });
    act(() => result.current.onPlayheadRect({ ...PLAYHEAD, x: 600 }));
    expect(setScroll).toHaveBeenLastCalledWith(250, 0);
  });

  it("follows the first resolved rectangle after remounting during playback", () => {
    const viewportRef = { current: { scrollX: 0, scrollY: 0, zoom: 1 } };
    const containerRef = { current: { clientWidth: 1000, clientHeight: 600 } as HTMLDivElement };
    const setScroll = vi.fn();
    const mount = () =>
      renderHook(() =>
        useFollowPlayhead({
          enabled: true,
          status: "playing",
          viewMode: "horizon",
          viewportRef,
          containerRef,
          setScroll,
        }),
      );
    const first = mount();
    act(() => first.result.current.onPlayheadRect(PLAYHEAD));
    first.unmount();
    const returned = mount();
    act(() => returned.result.current.onPlayheadRect(null));
    expect(setScroll).not.toHaveBeenCalled();
    act(() => returned.result.current.onPlayheadRect({ ...PLAYHEAD, x: 1200 }));
    expect(setScroll).toHaveBeenLastCalledWith(850, 0);
  });
});
