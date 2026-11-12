import { useEffect } from "react";
import { getVirituraApiBaseUrl } from "../config";
import { useDocumentStoreApi } from "../store/DocumentContext";
import type { McpToolResult } from "./toolDispatch";
import { useMcpSessionStore, type McpRegistration } from "./sessionStore";

interface HostMessage {
  readonly type?: string;
  readonly requestId?: string;
  readonly name?: string;
  readonly arguments?: unknown;
  readonly detail?: unknown;
}

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;

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
    useMcpSessionStore.getState().setRegistering(true);

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
        if (registration) {
          const canResume = await canResumeRegistration(registration, abortController.signal);
          if (disposed) return;
          if (!canResume) {
            registration = null;
            useMcpSessionStore.getState().setRegistering(true);
          }
        }
        if (!registration) {
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
          const created = (await response.json()) as McpRegistration;
          if (disposed) {
            await stopRegistration(created);
            return;
          }
          registration = created;
          useMcpSessionStore.getState().setRegistration(created);
          if (import.meta.env.DEV) {
            console.info(`[Viritura MCP] Browser session registered: ${created.sessionId}`);
          }
        }
        const newRegistration = registration;
        const newSocket = new WebSocket(newRegistration.hostWebSocketUrl);
        socket = newSocket;
        let lastHeartbeatAck = Date.now();
        let heartbeatTimer: number | null = null;
        const readyTimeout = window.setTimeout(() => newSocket.close(4000, "Relay handshake timed out."), 10_000);
        newSocket.addEventListener("open", () => {
          if (disposed) return;
          newSocket.send(
            JSON.stringify({
              type: "authenticate",
              hostToken: newRegistration.hostToken,
              metadata: readSessionMetadata(documentStore),
            }),
          );
        });
        newSocket.addEventListener("message", (event) => {
          if (disposed || socket !== newSocket) return;
          void handleHostMessage(
            newSocket,
            documentStore,
            event.data,
            () => {
              window.clearTimeout(readyTimeout);
              reconnectDelay = 1_000;
              lastHeartbeatAck = Date.now();
              if (heartbeatTimer !== null) return;
              heartbeatTimer = window.setInterval(() => {
                if (Date.now() - lastHeartbeatAck > HEARTBEAT_TIMEOUT_MS) {
                  newSocket.close(4000, "Relay heartbeat timed out.");
                } else if (newSocket.readyState === WebSocket.OPEN) {
                  newSocket.send(JSON.stringify({ type: "heartbeat" }));
                }
              }, HEARTBEAT_INTERVAL_MS);
            },
            () => {
              lastHeartbeatAck = Date.now();
            },
            () => !disposed && socket === newSocket,
          );
        });
        newSocket.addEventListener("close", () => {
          if (socket === newSocket) socket = null;
          window.clearTimeout(readyTimeout);
          if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
          scheduleReconnect("The editor relay disconnected; OAuth authorization is unchanged.");
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
        if (!disposed && (!(error instanceof Error) || error.name !== "AbortError")) {
          scheduleReconnect(error instanceof Error ? error.message : String(error));
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
  onReady: () => void,
  onHeartbeatAck: () => void,
  isCurrent: () => boolean,
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
    onReady();
    return;
  }
  if (message.type === "heartbeat_ack") {
    onHeartbeatAck();
    return;
  }
  if (message.type === "client_connected") {
    useMcpSessionStore.getState().setClientConnected(readClientName(message.detail));
    return;
  }
  if (message.type !== "tool_call" || !message.requestId || !message.name || socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  let result: McpToolResult;
  try {
    const { dispatchMcpTool } = await import("./toolDispatch");
    if (!isCurrent() || socket.readyState !== WebSocket.OPEN) return;
    result = await dispatchMcpTool(documentStore, message.name, message.arguments ?? {});
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const text = `Could not execute the MCP tool: ${detail}`;
    result = {
      content: [{ type: "text", text }],
      structuredContent: { code: "tool_failed", message: text },
      isError: true,
    };
  }
  if (isCurrent() && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "tool_result", requestId: message.requestId, result }));
  }
}

async function canResumeRegistration(registration: McpRegistration, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(
    `${getVirituraApiBaseUrl()}/mcp/sessions/${encodeURIComponent(registration.sessionId)}/host/status`,
    {
      headers: { Authorization: `Bearer ${registration.hostToken}` },
      credentials: "include",
      signal,
    },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Relay status check failed (${response.status}).`);
  return true;
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
    const response = await fetch(
      `${getVirituraApiBaseUrl()}/mcp/sessions/${encodeURIComponent(registration.sessionId)}/host`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${registration.hostToken}` },
        credentials: "include",
        keepalive: true,
      },
    );
    if (!response.ok) throw new Error(`Relay stop failed (${response.status}).`);
  } catch (error) {
    console.warn("[Viritura MCP] Could not stop the relay registration; it will expire.", error);
  }
}
