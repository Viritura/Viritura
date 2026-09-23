import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, ContextMenu, type ContextMenuState } from "@viritura/ui";

function Harness() {
  const [state, setState] = useState<ContextMenuState | null>(null);
  return (
    <>
      <Button
        onClick={() =>
          setState({
            x: 10,
            y: 10,
            items: [
              { label: "First action", action: vi.fn() },
              { label: "Second action", action: vi.fn() },
            ],
          })
        }
      >
        Open menu
      </Button>
      <ContextMenu state={state} onClose={() => setState(null)} />
    </>
  );
}

describe("ContextMenu keyboard navigation", () => {
  it("focuses the first action, navigates with arrows, and restores trigger focus on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open menu" });

    await user.click(trigger);
    const first = await screen.findByRole("menuitem", { name: "First action" });
    const second = screen.getByRole("menuitem", { name: "Second action" });
    await waitFor(() => expect(document.activeElement).toBe(first));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(second);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
