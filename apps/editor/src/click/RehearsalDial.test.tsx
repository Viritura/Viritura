import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RehearsalDial } from "./RehearsalDial";
import type { ClickBar } from "./barNavigation";

afterEach(cleanup);

describe("rehearsal dial", () => {
  it("distinguishes repeat visits and disables partial starts", () => {
    const visit = (visit: number, startable = true): ClickBar => ({
      measureIndex: 0,
      number: 1,
      rehearsal: "A",
      visit,
      visitCount: 3,
      startable,
    });
    const bars = [
      visit(1),
      { measureIndex: 1, number: 2, visit: 1, visitCount: 1, startable: true },
      visit(2),
      visit(3, false),
    ];
    const onSelect = vi.fn();
    render(<RehearsalDial bars={bars} index={0} enabled onSelect={onSelect} onSettlingChange={() => {}} />);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    fireEvent.click(screen.getByRole("option", { name: "Rehearsal A, Bar 1, visit 2 of 3" }));
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(screen.getByRole("option", { name: /partial visit/ }).hasAttribute("disabled")).toBe(true);
  });

  it("does not select a future rehearsal before its bar", () => {
    const bars: ClickBar[] = [
      { measureIndex: 0, number: 1, visit: 1, visitCount: 1, startable: true },
      { measureIndex: 1, number: 2, rehearsal: "A", visit: 1, visitCount: 1, startable: true },
    ];
    const onSelect = vi.fn();
    render(<RehearsalDial bars={bars} index={0} enabled onSelect={onSelect} onSettlingChange={() => {}} />);
    expect(screen.getByRole("option").getAttribute("aria-selected")).toBe("false");
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Rehearsal" }), { key: "ArrowLeft" });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Rehearsal" }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("lists named tempo changes beside rehearsal marks", () => {
    const bars: ClickBar[] = [
      { measureIndex: 0, number: 1, tempoName: "Adagio", visit: 1, visitCount: 1, startable: true },
      { measureIndex: 1, number: 2, visit: 1, visitCount: 1, startable: true },
      { measureIndex: 2, number: 3, rehearsal: "A", tempoName: "Allegro", visit: 1, visitCount: 1, startable: true },
    ];
    const onSelect = vi.fn();
    render(<RehearsalDial bars={bars} index={1} enabled onSelect={onSelect} onSettlingChange={() => {}} />);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "Tempo Adagio, Bar 1" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Rehearsal A, Tempo Allegro, Bar 3" }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("omits the track when there are no rehearsal marks", () => {
    const bars: ClickBar[] = [{ measureIndex: 0, number: 1, visit: 1, visitCount: 1, startable: true }];
    render(<RehearsalDial bars={bars} index={0} enabled onSelect={() => {}} onSettlingChange={() => {}} />);
    expect(screen.queryByRole("listbox", { name: "Rehearsal" })).toBeNull();
  });
});
