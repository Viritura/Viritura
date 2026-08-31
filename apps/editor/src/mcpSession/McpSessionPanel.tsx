import { useCallback } from "react";
import { Button, FormInput } from "@viritura/ui";
import { Bot, Copy, Link2Off, MessageSquareText, Radio } from "lucide-react";
import { toast } from "sonner";
import { useMcpSessionStore } from "./sessionStore";
import styles from "./McpSessionPanel.module.css";

/** Controls the live MCP browser host selected by the user's stable OAuth endpoint. */
export function McpSessionPanel() {
  const desired = useMcpSessionStore((state) => state.desired);
  const status = useMcpSessionStore((state) => state.status);
  const registration = useMcpSessionStore((state) => state.registration);
  const clientName = useMcpSessionStore((state) => state.clientName);
  const error = useMcpSessionStore((state) => state.error);
  const start = useMcpSessionStore((state) => state.start);
  const stop = useMcpSessionStore((state) => state.stop);

  const copyUrl = useCallback(async () => {
    if (!registration) return;
    await navigator.clipboard.writeText(registration.mcpUrl);
    toast.success("MCP URL copied");
  }, [registration]);

  const copySetupPrompt = useCallback(async () => {
    if (!registration) return;
    await navigator.clipboard.writeText(buildSetupPrompt(registration.mcpUrl));
    toast.success("MCP setup prompt copied");
  }, [registration]);

  return (
    <section className={styles.root} aria-label="MCP client">
      <div className={styles.heading}>
        <Bot size={16} />
        <div>
          <strong>MCP client</strong>
          <p>Let Copilot CLI and other MCP clients work with this open score.</p>
        </div>
      </div>

      {!desired ? (
        <Button variant="primary" size="sm" onClick={start} fullWidth testId="mcp-start-session">
          <Radio size={14} /> Connect MCP client
        </Button>
      ) : (
        <>
          <div className={styles.status} data-status={status}>
            <span className={styles.statusDot} />
            {statusLabel(status, clientName)}
          </div>
          {registration && (
            <>
              <div className={styles.urlRow}>
                <FormInput
                  aria-label="MCP server URL"
                  readOnly
                  value={registration.mcpUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button variant="ghost" size="sm" onClick={() => void copyUrl()} label="Copy MCP URL only">
                  <Copy size={14} />
                </Button>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void copySetupPrompt()}
                fullWidth
                testId="mcp-copy-setup-prompt"
              >
                <MessageSquareText size={14} /> Copy setup prompt
              </Button>
              <div className={styles.authSummary}>
                Paste the setup prompt into your MCP client&apos;s chat, or copy the URL for manual configuration. OAuth
                identifies your account; no access token is copied from Viritura.
              </div>
            </>
          )}
          <p className={styles.warning}>
            Access is enabled only for tabs where you select Connect MCP client. If multiple tabs or browsers opt in,
            the MCP client can discover each open score and address it separately. Proposed edits always require
            approval in the corresponding Viritura tab.
          </p>
          {error && <div className={styles.error}>{error}</div>}
          <Button variant="ghost" size="sm" onClick={stop} fullWidth testId="mcp-stop-session">
            <Link2Off size={14} /> Disconnect
          </Button>
        </>
      )}
    </section>
  );
}

function statusLabel(status: string, clientName: string | null): string {
  switch (status) {
    case "registering":
      return "Creating secure session…";
    case "waiting":
      return "Waiting for an MCP client";
    case "connected":
      return clientName ? `${clientName} connected` : "MCP client connected";
    case "error":
      return "Connection error";
    default:
      return "Not connected";
  }
}

function buildSetupPrompt(mcpUrl: string): string {
  return `Configure an MCP server named "viritura" in this client using the Streamable HTTP URL ${mcpUrl}. Use the server's OAuth flow. Do not add an Authorization header or ask me to paste an access token. Start the server, let me complete authorization in my browser, then verify the connection by calling editor.list_sessions.`;
}
