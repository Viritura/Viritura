import { describe, expect, it, vi } from "vitest";
import { dispatchPlayback, subscribePlaybackStatus } from "./usePlayback";

describe("playback status subscription", () => {
  it("reports transport transitions without playhead or mixer updates", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlaybackStatus(listener);
    try {
      dispatchPlayback({ type: "SET_STATUS", status: "playing" });
      dispatchPlayback({ type: "SET_VOLUME", volume: 0.4 });
      dispatchPlayback({ type: "SET_STATUS", status: "playing" });
      dispatchPlayback({ type: "SET_STATUS", status: "stopped" });
    } finally {
      unsubscribe();
    }
    dispatchPlayback({ type: "SET_STATUS", status: "playing" });
    dispatchPlayback({ type: "SET_STATUS", status: "stopped" });
    expect(listener.mock.calls).toEqual([["playing"], ["stopped"]]);
  });
});
