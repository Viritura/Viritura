import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentProvider } from "../store/DocumentContext";
import { McpSessionBridge } from "./McpSessionBridge";
import { useMcpSessionStore } from "./sessionStore";

class TestSocket {
  static readonly OPEN = 1;
  static readonly instances: TestSocket[] = [];
  readonly sent: { type: string }[] = [];
  readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  readyState = 0;

  constructor(readonly url: string) {
    TestSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(value: string) {
    this.sent.push(JSON.parse(value) as { type: string });
  }

  open() {
    this.readyState = TestSocket.OPEN;
    this.emit("open");
  }

  message(value: object) {
    this.emit("message", JSON.stringify(value));
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  private emit(type: string, data = "") {
    const event = new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const registration = (id: string) => ({
  sessionId: id,
  hostToken: `token-${id}`,
  mcpUrl: `https://api.example/mcp/sessions/${id}`,
  hostWebSocketUrl: `wss://api.example/mcp/sessions/${id}/host`,
});

describe("MCP relay reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", TestSocket);
    useMcpSessionStore.setState(useMcpSessionStore.getInitialState());
    useMcpSessionStore.getState().start();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function mount() {
    return render(
      <DocumentProvider>
        <McpSessionBridge />
      </DocumentProvider>,
    );
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("sends heartbeats and reconnects using the same authorized registration", async () => {
    let registrations = 0;
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? new Response(JSON.stringify(registration(String(++registrations))), { status: 200 })
        : new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await flush();
    const initialRegistrations = registrations;
    const sessionId = useMcpSessionStore.getState().registration!.sessionId;
    const first = TestSocket.instances[0]!;
    act(() => {
      first.open();
      first.message({ type: "ready" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(first.sent.map((item) => item.type)).toEqual(["authenticate", "heartbeat"]);
    act(() => {
      first.message({ type: "heartbeat_ack" });
      first.close();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(TestSocket.instances).toHaveLength(2);
    expect(TestSocket.instances[1]!.url).toBe(first.url);
    expect(registrations).toBe(initialRegistrations);
    const statusRequest = fetchMock.mock.calls.find(([url]) => url.endsWith("/host/status"));
    expect(statusRequest?.[1]?.headers).toEqual({ Authorization: `Bearer token-${sessionId}` });
  });

  it("loads the tool dispatcher on demand and returns its result to the relay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: RequestInit) =>
        options?.method === "POST"
          ? new Response(JSON.stringify(registration("one")), { status: 200 })
          : new Response(null, { status: 204 }),
      ),
    );
    mount();
    await flush();
    const socket = TestSocket.instances[0]!;
    await act(async () => {
      socket.open();
      socket.message({ type: "ready" });
      socket.message({ type: "tool_call", requestId: "request-1", name: "score.overview", arguments: {} });
      await vi.dynamicImportSettled();
    });
    expect(socket.sent).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        requestId: "request-1",
        result: expect.objectContaining({
          isError: true,
          structuredContent: { code: "no_document", message: expect.any(String) },
        }),
      }),
    );
  });

  it("reports dispatcher failures to the relay instead of leaving calls hanging", async () => {
    const dispatcher = await import("./toolDispatch");
    vi.spyOn(dispatcher, "dispatchMcpTool").mockRejectedValueOnce(new Error("Module execution failed"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: RequestInit) =>
        options?.method === "POST"
          ? new Response(JSON.stringify(registration("one")), { status: 200 })
          : new Response(null, { status: 204 }),
      ),
    );
    mount();
    await flush();
    const socket = TestSocket.instances[0]!;
    await act(async () => {
      socket.open();
      socket.message({ type: "ready" });
      socket.message({ type: "tool_call", requestId: "request-2", name: "score.overview", arguments: {} });
      await vi.dynamicImportSettled();
    });
    expect(socket.sent).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        requestId: "request-2",
        result: expect.objectContaining({
          isError: true,
          structuredContent: { code: "tool_failed", message: expect.stringContaining("Module execution failed") },
        }),
      }),
    );
  });

  it("does not execute a call after the session is stopped while the dispatcher loads", async () => {
    vi.resetModules();
    let release!: () => void;
    let markStarted!: () => void;
    const loading = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const dispatch = vi.fn(async () => ({ content: [] }));
    vi.doMock("./toolDispatch", async () => {
      markStarted();
      await loading;
      return { dispatchMcpTool: dispatch };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: RequestInit) =>
        options?.method === "POST"
          ? new Response(JSON.stringify(registration("one")), { status: 200 })
          : new Response(null, { status: 204 }),
      ),
    );
    try {
      const { unmount } = mount();
      await flush();
      const socket = TestSocket.instances[0]!;
      await act(async () => {
        socket.open();
        socket.message({ type: "ready" });
        socket.message({ type: "tool_call", requestId: "request-3", name: "score.overview", arguments: {} });
        await started;
      });
      unmount();
      await act(async () => {
        release();
        await vi.dynamicImportSettled();
      });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      release();
      vi.doUnmock("./toolDispatch");
      vi.resetModules();
    }
  });

  it("creates a fresh registration only when the relay no longer knows the old one", async () => {
    let registrations = 0;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        registrations += 1;
        return new Response(JSON.stringify(registration(String(registrations))), { status: 200 });
      }
      return new Response(null, { status: url.endsWith("/host/status") ? 404 : 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await flush();
    const initialRegistrations = registrations;
    act(() => TestSocket.instances[0]!.close());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(registrations).toBe(initialRegistrations + 1);
    expect(TestSocket.instances[1]!.url).toContain(`/${registrations}/host`);
  });

  it("retains the registration through network failures and retries", async () => {
    let statusChecks = 0;
    let registrations = 0;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        return new Response(JSON.stringify(registration(String(++registrations))), { status: 200 });
      }
      if (url.endsWith("/host/status")) {
        statusChecks += 1;
        if (statusChecks === 1) throw new Error("Network unavailable");
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await flush();
    const initialRegistrations = registrations;
    const sessionId = useMcpSessionStore.getState().registration!.sessionId;
    act(() => TestSocket.instances[0]!.close());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(useMcpSessionStore.getState().registration?.sessionId).toBe(sessionId);
    expect(TestSocket.instances).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(TestSocket.instances).toHaveLength(2);
    expect(registrations).toBe(initialRegistrations);
  });

  it("reconnects a stalled heartbeat without replacing the registration", async () => {
    let registrations = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: RequestInit) =>
        options?.method === "POST"
          ? new Response(JSON.stringify(registration(String(++registrations))), { status: 200 })
          : new Response(null, { status: 204 }),
      ),
    );
    mount();
    await flush();
    const initialRegistrations = registrations;
    const first = TestSocket.instances[0]!;
    act(() => {
      first.open();
      first.message({ type: "ready" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80_000);
    });
    act(() => first.message({ type: "heartbeat_ack" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80_000);
    });
    expect(first.readyState).toBe(TestSocket.OPEN);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21_000);
    });
    expect(first.readyState).toBe(3);
    expect(TestSocket.instances).toHaveLength(2);
    expect(registrations).toBe(initialRegistrations);
  });

  it("does not create a socket when unmounted during a status check", async () => {
    let finishStatus: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (options?.method === "POST") return new Response(JSON.stringify(registration("one")), { status: 200 });
        if (url.endsWith("/host/status"))
          return new Promise<Response>((resolve) => {
            finishStatus = resolve;
          });
        return new Response(null, { status: 204 });
      }),
    );
    const { unmount } = mount();
    await flush();
    act(() => TestSocket.instances[0]!.close());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(finishStatus).toBeDefined();
    unmount();
    await act(async () => {
      finishStatus?.(new Response(null, { status: 204 }));
    });
    expect(TestSocket.instances).toHaveLength(1);
    expect(useMcpSessionStore.getState().status).toBe("idle");
  });
});
