import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ViewLayout } from "../components/ViewLayout";
import { requestPanelToggle } from "../keyboard/panelToggle";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ViewLayout left panel", () => {
  it("snaps to the minimum when released before the collapse threshold", () => {
    render(
      <ViewLayout layoutId="left-panel-snap-test" leftPanel={{ content: <div>Activity tools</div> }}>
        <div>Main content</div>
      </ViewLayout>,
    );

    const resizeHandle = document.querySelector<HTMLElement>('[data-side="right"]');
    fireEvent.pointerDown(resizeHandle!, { clientX: 280, pointerId: 1 });
    fireEvent.pointerMove(resizeHandle!, { clientX: 190, pointerId: 1 });
    expect(resizeHandle!.parentElement?.style.width).toBe("190px");

    fireEvent.pointerUp(resizeHandle!, { clientX: 190, pointerId: 1 });

    expect(screen.getByText("Activity tools")).toBeTruthy();
    expect(resizeHandle!.parentElement?.style.width).toBe("200px");
    expect(window.localStorage.getItem("viritura.left-panel-snap-test.leftW")).toBe("200");
  });

  it("collapses while resizing across the threshold and reopens from the workspace edge", async () => {
    const user = userEvent.setup();
    render(
      <ViewLayout layoutId="left-panel-test" leftPanel={{ content: <div>Activity tools</div> }}>
        <div>Main content</div>
      </ViewLayout>,
    );

    const resizeHandle = document.querySelector<HTMLElement>('[data-side="right"]');
    expect(resizeHandle).toBeTruthy();
    expect(resizeHandle!.parentElement?.style.position).toBe("absolute");
    expect(resizeHandle!.parentElement?.style.left).toBe("14px");
    expect(resizeHandle!.parentElement?.style.height).toBe("calc(100% - 28px)");
    fireEvent.pointerDown(resizeHandle!, { clientX: 280, pointerId: 1 });
    fireEvent.pointerMove(resizeHandle!, { clientX: 180, pointerId: 1 });

    expect(resizeHandle!.parentElement?.style.width).toBe("180px");
    expect(window.localStorage.getItem("viritura.left-panel-test.leftW")).toBeNull();

    fireEvent.pointerMove(resizeHandle!, { clientX: 168, pointerId: 1 });

    expect(screen.queryByText("Activity tools")).toBeNull();
    expect(window.localStorage.getItem("viritura.left-panel-test.leftW:collapsed")).toBe("1");
    expect(window.localStorage.getItem("viritura.left-panel-test.leftW")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show panels" }));

    expect(screen.getByText("Activity tools")).toBeTruthy();
    expect(window.localStorage.getItem("viritura.left-panel-test.leftW:collapsed")).toBe("0");

    act(() => requestPanelToggle());
    expect(screen.queryByText("Activity tools")).toBeNull();

    act(() => requestPanelToggle());
    expect(screen.getByText("Activity tools")).toBeTruthy();
  });
});
