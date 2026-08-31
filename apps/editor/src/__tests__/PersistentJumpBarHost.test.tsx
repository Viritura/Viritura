import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { PersistentJumpBarHost } from "../app/PersistentJumpBarHost";
import { setJumpBarCatalog } from "../store/jumpBarStore";
import { setJumpBarOpen } from "../store/overlayStore";

afterEach(() => {
  cleanup();
  setJumpBarOpen(false);
});

describe("PersistentJumpBarHost", () => {
  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
  ])("opens from the app shell with %s+Space", async (_label, modifier) => {
    setJumpBarCatalog(
      [{ id: "activity.picture", label: "Go to Picture", category: "Activity", execute: () => {} }],
      () => null,
    );
    render(<PersistentJumpBarHost />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, ...modifier }));
    });

    await waitFor(() => expect(screen.getByPlaceholderText("Type a command or location…")).toBeTruthy());
    expect(screen.getByText("Go to Picture")).toBeTruthy();
  });
});
