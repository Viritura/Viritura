/** Max characters of debug body to put in a GitHub issue URL. GitHub rejects
 *  very long URLs (~8 KB total), so the prefilled body is truncated well
 *  under that; the full report is still available via "Copy debug info". */
const MAX_ISSUE_BODY = 6000;

export interface DebugReportInput {
  error: Error;
  /** React component stack from `componentDidCatch` (may be unavailable). */
  componentStack?: string | null;
}

/**
 * Build a human-readable, paste-ready debug report for an unhandled render
 * error. Safe to call in any environment — guards `location`/`navigator`
 * access so it works under SSR and tests.
 */
export function buildDebugReport({ error, componentStack }: DebugReportInput): string {
  const href = typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "(unknown)";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "(unknown)";
  const when = new Date().toISOString();
  const stack = error.stack ?? "(no stack)";

  const lines = [
    "**Viritura rendering error**",
    "",
    `**Message:** ${error.message || "(empty message)"}`,
    `**URL:** ${href}`,
    `**User agent:** ${ua}`,
    `**Time:** ${when}`,
    "",
    "**Stack trace**",
    "```",
    stack,
    "```",
  ];

  if (componentStack) {
    lines.push("", "**Component stack**", "```", componentStack.trim(), "```");
  }

  return lines.join("\n");
}

/**
 * Compose a prefilled GitHub "new issue" URL from a report. `baseUrl` is the
 * repository's `.../issues/new` endpoint. The body is truncated to keep the
 * URL within GitHub's length limit.
 */
export function buildIssueUrl(baseUrl: string, error: Error, report: string): string {
  const firstLine = (error.message || "Rendering error").split("\n")[0]!.slice(0, 120);
  const body =
    report.length > MAX_ISSUE_BODY
      ? `${report.slice(0, MAX_ISSUE_BODY)}\n\n…(truncated — use "Copy debug info" for the full report)`
      : report;
  const params = new URLSearchParams({
    title: `Rendering error: ${firstLine}`,
    body,
  });
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Copy text to the clipboard, with a `document.execCommand` fallback for
 * non-secure contexts where `navigator.clipboard` is unavailable. Resolves
 * to whether the copy succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
