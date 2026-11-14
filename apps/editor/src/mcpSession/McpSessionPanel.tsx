import { useCallback, useState } from "react";
import { Button, Checkbox, FormInput, IconButton } from "@viritura/ui";
import { Bot, Copy, Link2Off, MessageSquareText, Radio } from "lucide-react";
import { toast } from "sonner";
import { useMcpSessionStore } from "./sessionStore";
import styles from "./McpSessionPanel.module.css";

/** Controls the live MCP browser host selected by the user's stable OAuth endpoint. */
export function McpSessionPanel() {
  const desired = useMcpSessionStore((state) => state.desired);
  const sessionAutoAccept = useMcpSessionStore((state) => state.autoAccept);
  const [pendingAutoAccept, setPendingAutoAccept] = useState(false);
  const status = useMcpSessionStore((state) => state.status);
  const registration = useMcpSessionStore((state) => state.registration);
  const clientName = useMcpSessionStore((state) => state.clientName);
  const error = useMcpSessionStore((state) => state.error);
  const start = useMcpSessionStore((state) => state.start);
  const stop = useMcpSessionStore((state) => state.stop);
  const setAutoAccept = useMcpSessionStore((state) => state.setAutoAccept);
  const autoAccept = desired ? sessionAutoAccept : pendingAutoAccept;

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
        <Bot size={16} aria-hidden="true" />
        <div>
          <strong className={styles.title}>MCP client</strong>
          <p className={styles.hint}>Let Copilot CLI or another MCP client read and edit this score.</p>
        </div>
      </div>

      {desired && (
        <div className={styles.status} data-status={status} role="status">
          <span className={styles.statusDot} aria-hidden="true" />
          {statusLabel(status, clientName)}
        </div>
      )}

      {desired && registration && (
        <div className={styles.group}>
          <div className={styles.urlRow}>
            <FormInput
              aria-label="MCP server URL"
              readOnly
              value={registration.mcpUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <IconButton size="md" onClick={() => void copyUrl()} tooltip="Copy MCP URL">
              <Copy size={14} />
            </IconButton>
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
          <p className={styles.hint}>One-time setup: paste the prompt into your client, then sign in when asked.</p>
        </div>
      )}

      <div className={styles.group}>
        <Checkbox
          label="Auto-accept proposed edits"
          checked={autoAccept}
          onChange={(event) =>
            desired ? setAutoAccept(event.target.checked) : setPendingAutoAccept(event.target.checked)
          }
          aria-describedby="mcp-auto-accept-hint"
        />
        <p id="mcp-auto-accept-hint" className={styles.hint}>
          {autoAccept
            ? "Validated edits apply without review. Use only with a trusted client."
            : "Each proposed edit opens a review in this tab."}
        </p>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {desired ? (
        <Button variant="ghost" size="sm" onClick={stop} fullWidth testId="mcp-stop-session">
          <Link2Off size={14} /> Disconnect
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            start({ autoAccept: pendingAutoAccept });
            setPendingAutoAccept(false);
          }}
          fullWidth
          testId="mcp-start-session"
        >
          <Radio size={14} /> Connect this tab
        </Button>
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
  return `Add an MCP server named "viritura" with the Streamable HTTP URL ${mcpUrl}, then call editor.list_sessions to confirm it works.`;
}
