import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, TextPopover } from "@viritura/ui";

afterEach(cleanup);

describe("TextPopover continuous navigation", () => {
  it.each(["{Enter}", " "])("preserves child-button activation for %s", async (key) => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const navigate = vi.fn(() => true);
    const remove = vi.fn();
    const close = vi.fn();
    render(
      <TextPopover
        open
        position={{ x: 100, y: 100 }}
        initialValue="C7"
        onClose={close}
        onSubmit={submit}
        onNavigate={navigate}
        spaceNavigation="measure"
      >
        <Button label="Remove chord" onClick={remove} />
      </TextPopover>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove chord" }));
    await user.keyboard(key);
    expect(remove).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
  });

  it("allows spaces when continuous navigation is not configured", async () => {
    const user = userEvent.setup();
    render(<TextPopover open position={{ x: 100, y: 100 }} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "Allegro q=120");

    expect((input as HTMLInputElement).value).toBe("Allegro q=120");
  });

  it("submits a navigation command without closing and clears the input", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn(() => true);
    const close = vi.fn();
    render(
      <TextPopover
        open
        position={{ x: 100, y: 100 }}
        title="Chord Symbol"
        onClose={close}
        onSubmit={vi.fn()}
        onNavigate={navigate}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "C7");

    fireEvent.keyDown(window, { key: " " });

    expect(navigate).toHaveBeenCalledWith("C7", "next");
    expect(close).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("maps shifted space and modifier arrows to previous and measure navigation", () => {
    const navigate = vi.fn(() => true);
    render(
      <TextPopover open position={{ x: 100, y: 100 }} onClose={vi.fn()} onSubmit={vi.fn()} onNavigate={navigate} />,
    );

    fireEvent.keyDown(window, { key: " ", shiftKey: true });
    fireEvent.keyDown(window, { key: ";" });
    fireEvent.keyDown(window, { key: ":", shiftKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true });

    expect(navigate.mock.calls.map(([, command]) => command)).toEqual([
      "previous",
      "nextBeat",
      "previousBeat",
      "nextMeasure",
      "previousMeasure",
    ]);
  });

  it("uses bar navigation for chord entry without changing beat shortcuts", () => {
    const navigate = vi.fn(() => true);
    render(
      <TextPopover
        open
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onNavigate={navigate}
        spaceNavigation="measure"
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C7" } });
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: " ", shiftKey: true });
    fireEvent.keyDown(window, { key: ";" });
    fireEvent.keyDown(window, { key: ":", shiftKey: true });
    expect(navigate.mock.calls).toEqual([
      ["C7", "nextMeasure"],
      ["", "previousMeasure"],
      ["", "nextBeat"],
      ["", "previousBeat"],
    ]);
  });
});
