import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BarDial } from "./BarDial";
import type { ClickBar } from "./barNavigation";

afterEach(cleanup);

function bar(index: number, startable = true): ClickBar {
  return { measureIndex: index, number: index + 1, visit: 1, visitCount: 1, startable };
}

describe("bar dial", () => {
  it("skips partial visits when using the keyboard", () => {
    const onSelect = vi.fn();
    render(
      <BarDial
        bars={[bar(0), bar(1, false), bar(2)]}
        index={0}
        enabled
        onSelect={onSelect}
        onSettlingChange={() => {}}
      />,
    );
    expect(screen.getByRole("option", { name: "Bar 2, partial visit" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Start bar" }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("settles line-based mouse wheel input before re-enabling Play", async () => {
    const onSelect = vi.fn();
    const onSettlingChange = vi.fn();
    render(
      <BarDial
        bars={Array.from({ length: 10 }, (_, index) => bar(index))}
        index={0}
        enabled
        onSelect={onSelect}
        onSettlingChange={onSettlingChange}
      />,
    );
    const dial = screen.getByRole("listbox", { name: "Start bar" });
    fireEvent.wheel(dial, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(screen.getByRole("option", { name: "Bar 2" }).getAttribute("aria-selected")).toBe("true");
    expect(onSettlingChange).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(onSettlingChange).toHaveBeenLastCalledWith(false));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("drags horizontally like a dial and snaps to the nearest bar on release", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const onSelect = vi.fn();
    const onSettlingChange = vi.fn();
    render(
      <BarDial
        bars={Array.from({ length: 20 }, (_, index) => bar(index))}
        index={0}
        enabled
        onSelect={onSelect}
        onSettlingChange={onSettlingChange}
      />,
    );
    const dial = screen.getByRole("listbox", { name: "Start bar" });
    fireEvent.pointerDown(dial, { pointerId: 1, pointerType: "touch", clientX: 300 });
    expect(onSettlingChange).toHaveBeenLastCalledWith(true);
    now = 400;
    fireEvent.pointerMove(dial, { pointerId: 1, clientX: 130 });
    expect(screen.getByRole("option", { name: "Bar 3" }).getAttribute("aria-selected")).toBe("true");
    now = 600;
    fireEvent.pointerUp(dial, { pointerId: 1, clientX: 130 });
    expect(onSelect).toHaveBeenLastCalledWith(2);
    expect(onSettlingChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("option", { name: "Bar 3" }));
    expect(onSelect).toHaveBeenCalledOnce();

    now = 1_000;
    fireEvent.pointerDown(dial, { pointerId: 2, pointerType: "touch", clientX: 300 });
    now = 1_040;
    fireEvent.pointerMove(dial, { pointerId: 2, clientX: 220 });
    now = 1_080;
    fireEvent.pointerUp(dial, { pointerId: 2, clientX: 140 });
    expect(onSelect.mock.lastCall?.[0]).toBeGreaterThan(5);
    vi.restoreAllMocks();
  });

  it("renders a bounded window even for a long performance", () => {
    const onSelect = vi.fn();
    const bars = Array.from({ length: 10_000 }, (_, index) => bar(index));
    render(<BarDial bars={bars} index={0} enabled onSelect={onSelect} onSettlingChange={() => {}} />);
    expect(screen.getAllByRole("option").length).toBeLessThan(20);
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Start bar" }), { key: "End" });
    expect(onSelect).toHaveBeenCalledWith(9_999);
  });

  it("keeps the scrolled position when a touch begins immediately after an automatic jump", () => {
    const bars = Array.from({ length: 10_000 }, (_, index) => bar(index));
    render(<BarDial bars={bars} index={9_999} enabled onSelect={() => {}} onSettlingChange={() => {}} />);
    fireEvent.pointerDown(screen.getByRole("listbox", { name: "Start bar" }), { pointerType: "touch" });
    expect(screen.getByRole("option", { name: "Bar 10000" }).getAttribute("aria-selected")).toBe("true");
  });
});
