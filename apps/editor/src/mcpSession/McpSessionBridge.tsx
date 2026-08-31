import { useEffect } from "react";
import { getVirituraApiBaseUrl } from "../config";
import { useDocumentStoreApi } from "../store/DocumentContext";
import { dispatchMcpTool } from "./toolDispatch";
import { useMcpSessionStore, type McpRegistration } from "./sessionStore";

interface HostMessage {
  readonly type?: string;
  readonly requestId?: string;
  readonly name?: string;
  readonly arguments?: unknown;
  readonly detail?: unknown;
}

/**
 * Owns the browser side of the MCP relay. It stays mounted with Write mode so
 * closing the Assistant panel does not disconnect a running external client.
 */
export function McpSessionBridge() {
  const desired = useMcpSessionStore((state) => state.desired);
  const documentStore = useDocumentStoreApi();

  useEffect(() => {
    if (!desired) {
      useMcpSessionStore.getState().clear();
      return;
    }

    const abortController = new AbortController();
    let disposed = false;
    let registration: McpRegistration | null = null;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelay = 1_000;
    useMcpSessionStore.getState().setRegistering();

    const scheduleReconnect = (message: string) => {
      if (disposed || reconnectTimer !== null) return;
      useMcpSessionStore.getState().setError(`${message} Reconnecting…`);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    };

    const connect = async () => {
      useMcpSessionStore.getState().setRegistering();
      try {
        const response = await fetch(`${getVirituraApiBaseUrl()}/mcp/sessions`, {
          method: "POST",
          headers: { "X-Viritura-MCP-Registration": "1" },
          credentials: "include",
          signal: abortController.signal,
        });
        if (response.status === 401) {
          throw new Error("Sign in to Viritura to connect an MCP client.");
        }
        if (!response.ok) throw new Error(`Session registration failed (${response.status}).`);
        const newRegistration = (await response.json()) as McpRegistration;
        if (disposed) {
          await stopRegistration(newRegistration);
          return;
        }

        registration = newRegistration;
        useMcpSessionStore.getState().setRegistration(newRegistration);
        if (import.meta.env.DEV) {
          console.info(`[Viritura MCP] Browser session registered: ${newRegistration.sessionId}`);
        }
        const newSocket = new WebSocket(newRegistration.hostWebSocketUrl);
        socket = newSocket;
        newSocket.addEventListener("open", () => {
          reconnectDelay = 1_000;
          newSocket.send(
            JSON.stringify({
              type: "authenticate",
              hostToken: newRegistration.hostToken,
              metadata: readSessionMetadata(documentStore),
            }),
          );
        });
        newSocket.addEventListener("message", (event) => {
          void handleHostMessage(newSocket, documentStore, event.data);
        });
        newSocket.addEventListener("close", () => {
          if (socket === newSocket) socket = null;
          if (registration === newRegistration) {
            registration = null;
            void stopRegistration(newRegistration);
          }
          scheduleReconnect("The MCP relay disconnected.");
        });

        let lastMetadata = "";
        const sendMetadata = () => {
          if (newSocket.readyState === WebSocket.OPEN) {
            const metadata = JSON.stringify(readSessionMetadata(documentStore));
            if (metadata !== lastMetadata) {
              lastMetadata = metadata;
              newSocket.send(JSON.stringify({ type: "host_state", metadata: JSON.parse(metadata) as object }));
            }
          }
        };
        const unsubscribeDocument = documentStore.subscribe(sendMetadata);
        window.addEventListener("focus", sendMetadata);
        window.addEventListener("blur", sendMetadata);
        document.addEventListener("visibilitychange", sendMetadata);
        newSocket.addEventListener("close", () => {
          unsubscribeDocument();
          window.removeEventListener("focus", sendMetadata);
          window.removeEventListener("blur", sendMetadata);
          document.removeEventListener("visibilitychange", sendMetadata);
        });
      } catch (error) {
        if (!disposed && error instanceof Error && error.name !== "AbortError") {
          scheduleReconnect(error.message);
        }
      }
    };

    void connect();
    return () => {
      disposed = true;
      abortController.abort();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close(1000, "Viritura stopped exposing this session.");
      if (registration) void stopRegistration(registration);
      useMcpSessionStore.getState().clear();
    };
  }, [desired, documentStore]);

  return null;
}

function readSessionMetadata(documentStore: ReturnType<typeof useDocumentStoreApi>) {
  const state = documentStore.getState();
  return {
    title: state.workingScore?.metadata?.title ?? null,
    fileName: state.fileName || null,
    documentId: readDocumentId(state.fileName),
    focused: document.hasFocus() && document.visibilityState === "visible",
  };
}

function readDocumentId(fileName: string) {
  if (/^https?:\/\//i.test(fileName)) return `url:${new URL(fileName).href}`;
  return null;
}

async function handleHostMessage(
  socket: WebSocket | null,
  documentStore: ReturnType<typeof useDocumentStoreApi>,
  data: unknown,
) {
  if (typeof data !== "string") return;
  let message: HostMessage;
  try {
    message = JSON.parse(data) as HostMessage;
  } catch {
    return;
  }

  if (message.type === "ready") {
    useMcpSessionStore.getState().setReady();
    return;
  }
  if (message.type === "client_connected") {
    useMcpSessionStore.getState().setClientConnected(readClientName(message.detail));
    return;
  }
  if (message.type !== "tool_call" || !message.requestId || !message.name || socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  const result = await dispatchMcpTool(documentStore, message.name, message.arguments ?? {});
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "tool_result", requestId: message.requestId, result }));
  }
}

function readClientName(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null) return null;
  const clientInfo = (detail as Record<string, unknown>).clientInfo;
  if (typeof clientInfo !== "object" || clientInfo === null) return null;
  const name = (clientInfo as Record<string, unknown>).name;
  return typeof name === "string" ? name.slice(0, 80) : null;
}

async function stopRegistration(registration: McpRegistration): Promise<void> {
  try {
    await fetch(`${getVirituraApiBaseUrl()}/mcp/sessions/${encodeURIComponent(registration.sessionId)}/host`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${registration.hostToken}` },
      credentials: "include",
      keepalive: true,
    });
  } catch {
    // The in-memory session expires automatically if the API is unreachable.
  }
}
