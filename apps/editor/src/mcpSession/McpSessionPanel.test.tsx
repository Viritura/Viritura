import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { McpSessionPanel } from "./McpSessionPanel";
import { useMcpSessionStore } from "./sessionStore";

beforeEach(() => useMcpSessionStore.setState(useMcpSessionStore.getInitialState()));
afterEach(cleanup);

describe("MCP session approval setting", () => {
  it("starts in manual approval mode by default", () => {
    render(<McpSessionPanel />);
    const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: /Auto-accept/ });
    expect(checkbox.checked).toBe(false);

    fireEvent.click(screen.getByTestId("mcp-start-session"));

    expect(useMcpSessionStore.getState()).toMatchObject({ desired: true, autoAccept: false });
    expect(screen.getByText(/Proposed edits require approval/)).toBeTruthy();
  });

  it("opts in for one session and resets the choice after disconnecting", () => {
    render(<McpSessionPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Auto-accept/ }));
    fireEvent.click(screen.getByTestId("mcp-start-session"));

    expect(useMcpSessionStore.getState()).toMatchObject({ desired: true, autoAccept: true });
    expect(screen.getByText(/Auto-accept is enabled for this session/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("mcp-stop-session"));

    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /Auto-accept/ }).checked).toBe(false);
    fireEvent.click(screen.getByTestId("mcp-start-session"));
    expect(useMcpSessionStore.getState().autoAccept).toBe(false);
  });
});
