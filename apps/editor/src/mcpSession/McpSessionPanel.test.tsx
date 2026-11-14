import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipPrimitives } from "@viritura/ui";
import { McpSessionPanel } from "./McpSessionPanel";
import { useMcpSessionStore } from "./sessionStore";

beforeEach(() => useMcpSessionStore.setState(useMcpSessionStore.getInitialState()));
afterEach(cleanup);

const autoAcceptBox = () => screen.getByRole<HTMLInputElement>("checkbox", { name: /Auto-accept/ });

describe("MCP session approval setting", () => {
  it("starts in manual approval mode by default", () => {
    render(<McpSessionPanel />);
    expect(autoAcceptBox().checked).toBe(false);

    fireEvent.click(screen.getByTestId("mcp-start-session"));

    expect(useMcpSessionStore.getState()).toMatchObject({ desired: true, autoAccept: false });
    expect(screen.getByText(/opens a review in this tab/)).toBeTruthy();
  });

  it("opts in for one session and resets the choice after disconnecting", () => {
    render(<McpSessionPanel />);
    fireEvent.click(autoAcceptBox());
    fireEvent.click(screen.getByTestId("mcp-start-session"));

    expect(useMcpSessionStore.getState()).toMatchObject({ desired: true, autoAccept: true });
    expect(screen.getByText(/apply without review/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("mcp-stop-session"));

    expect(autoAcceptBox().checked).toBe(false);
    fireEvent.click(screen.getByTestId("mcp-start-session"));
    expect(useMcpSessionStore.getState().autoAccept).toBe(false);
  });

  it("toggles auto-accept while a session is active", () => {
    render(<McpSessionPanel />);
    fireEvent.click(screen.getByTestId("mcp-start-session"));

    fireEvent.click(autoAcceptBox());
    expect(useMcpSessionStore.getState().autoAccept).toBe(true);
    fireEvent.click(autoAcceptBox());
    expect(useMcpSessionStore.getState().autoAccept).toBe(false);
  });

  it("copies a setup prompt without token-handling instructions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    useMcpSessionStore.getState().start();
    useMcpSessionStore.getState().setRegistration({
      sessionId: "s",
      hostToken: "t",
      mcpUrl: "https://api.example/mcp",
      hostWebSocketUrl: "wss://api.example/host",
    });
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <McpSessionPanel />
      </TooltipPrimitives.Provider>,
    );

    fireEvent.click(screen.getByTestId("mcp-copy-setup-prompt"));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const prompt = String(writeText.mock.calls[0]?.[0]);
    expect(prompt).toContain("https://api.example/mcp");
    expect(prompt).not.toMatch(/token|Authorization/i);
  });
});
