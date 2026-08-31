import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlayheadRect } from "@viritura/playback";
import type { ViewportState } from "../viewport";
import { useFollowPlayhead } from "../hooks/useFollowPlayhead";

const PLAYHEAD: PlayheadRect = { x: 350, yTop: 200, yBottom: 400 };

describe("useFollowPlayhead", () => {
  it.each(["playing", "paused"] as const)(
    "waits for a %s user-scroll commit before recapturing the horizontal anchor",
    (status) => {
      const viewportRef: { current: ViewportState } = {
        current: { scrollX: 0, scrollY: 0, zoom: 1 },
      };
      const containerRef = {
        current: { clientWidth: 1000, clientHeight: 600 } as HTMLDivElement,
      };
      const setScroll = vi.fn();
      const { result, rerender } = renderHook(
        ({ transportStatus }: { transportStatus: "playing" | "paused" }) =>
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
      if (status === "paused") rerender({ transportStatus: "paused" });

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
    },
  );
});
