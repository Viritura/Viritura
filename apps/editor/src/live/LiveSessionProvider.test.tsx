import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

// vitest.setup.ts enables RTL's `reactStrictMode`. These tests pin the
// auto-join lifecycle described in LiveSessionProvider's comments: the session
// lives in a Zustand singleton, so it must survive the mount→cleanup→mount
// double-invoke without leaking peer connections, and must still be recreated
// after a genuine unmount/remount (a `useRef` "already tried" guard would
// survive the remount and strand both peers).

const hoisted = vi.hoisted(() => ({
  identity: { id: "guest-1", name: "Tester", color: "#fff" },
  roomId: "ROOM-1" as string | null,
  created: 0,
  destroyed: 0,
  status: "idle" as string,
}));

function startLive(): string {
  if (hoisted.status === "active") hoisted.destroyed += 1;
  hoisted.created += 1;
  hoisted.status = "active";
  return hoisted.roomId ?? "ROOM-1";
}

vi.mock("./liveSessionStore", () => ({
  useLiveSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ startLive, status: hoisted.status, session: null }),
}));
vi.mock("./useLiveBridge", () => ({ useLiveBridge: () => undefined }));
vi.mock("./useLocalCursorBroadcast", () => ({ useLocalCursorBroadcast: () => undefined }));
vi.mock("./useHostPresenceWatcher", () => ({ useHostPresenceWatcher: () => undefined }));
vi.mock("./liveUrl", () => ({
  parseLiveRoomIdFromUrl: () => hoisted.roomId,
  parseLiveSignalingFromUrl: () => null,
  parseLiveTransportFromUrl: () => null,
}));
vi.mock("./identity", () => ({
  buildAuthenticatedIdentity: () => hoisted.identity,
  buildGuestIdentity: () => hoisted.identity,
  getStoredGuestName: () => "Tester",
  setStoredGuestName: () => undefined,
  subscribeStoredGuestName: () => () => undefined,
}));
vi.mock("../auth/useVirituraAccount", () => ({
  useVirituraAccount: () => ({ user: null, status: "ready" }),
}));
vi.mock("@viritura/ui", () => ({ PromptDialog: () => null }));

import { LiveSessionProvider } from "./LiveSessionProvider";

beforeEach(() => {
  hoisted.roomId = "ROOM-1";
  hoisted.created = 0;
  hoisted.destroyed = 0;
  hoisted.status = "idle";
});

afterEach(() => {
  cleanup();
});

describe("LiveSessionProvider auto-join under StrictMode", () => {
  it("leaves exactly one live session after the mount double-invoke", async () => {
    render(<LiveSessionProvider />);

    await waitFor(() => expect(hoisted.status).toBe("active"));
    // The second invoke re-runs with the render's captured `status`, so it
    // recreates rather than skipping — startLive tears the first session down.
    expect(hoisted.created).toBeGreaterThan(1);
    expect(hoisted.created - hoisted.destroyed).toBe(1);
  });

  it("does not auto-join when a session is already active", async () => {
    hoisted.status = "active";
    render(<LiveSessionProvider />);

    await waitFor(() => expect(hoisted.status).toBe("active"));
    expect(hoisted.created).toBe(0);
  });

  it("does not auto-join without a ?live= room id", async () => {
    hoisted.roomId = null;
    render(<LiveSessionProvider />);

    await waitFor(() => expect(hoisted.status).toBe("idle"));
    expect(hoisted.created).toBe(0);
  });

  it("re-joins after a full unmount and remount", async () => {
    const view = render(<LiveSessionProvider />);
    await waitFor(() => expect(hoisted.status).toBe("active"));
    view.unmount();

    // The store singleton outlives the component, but a fresh visit starts idle.
    hoisted.status = "idle";
    render(<LiveSessionProvider />);

    await waitFor(() => expect(hoisted.status).toBe("active"));
    expect(hoisted.created - hoisted.destroyed).toBe(2);
  });
});
