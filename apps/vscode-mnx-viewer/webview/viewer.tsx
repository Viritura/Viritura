/* eslint-disable react-refresh/only-export-components --
 * VS Code webview entry point. Top-level components own the root render
 * and aren't reused elsewhere — Fast Refresh doesn't apply. */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { ScoreViewer, type ScoreViewerScoreOption } from "@viritura/score-viewer-react";

const MESSAGE_PANEL_STYLE: CSSProperties = {
  boxSizing: "border-box",
  maxWidth: 760,
  margin: "32px auto",
  padding: 16,
  border: "1px solid var(--vscode-panel-border)",
  borderRadius: 6,
  background: "var(--vscode-editorWidget-background)",
  color: "var(--vscode-editor-foreground)",
};
const MESSAGE_PRE_STYLE: CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "var(--vscode-errorForeground)",
  fontFamily: "var(--vscode-editor-font-family, monospace)",
  fontSize: "12px",
};
function messageTitleStyle(hasDetail: boolean): CSSProperties {
  return { fontWeight: 700, marginBottom: hasDetail ? 8 : 0 };
}
const VIEWER_ROOT_STYLE: CSSProperties = { width: "100%", height: "100%", position: "relative" };
const SCORE_VIEWER_STYLE: CSSProperties = {
  background: "var(--vscode-editor-background)",
  color: "var(--vscode-editor-foreground)",
};
const VIEWPORT_STYLE: CSSProperties = { padding: 24 };

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface ViewerBootstrap {
  readonly assetBaseUrl: string;
  readonly fileName: string;
}

interface DocumentMessage {
  readonly type: "document";
  readonly fileName: string;
  readonly text: string;
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason, null, 2);
  } catch {
    return String(reason);
  }
}

function scoreLabel(score: unknown, index: number): string {
  if (typeof score !== "object" || score === null) return `Score ${index + 1}`;
  const fields = score as Record<string, unknown>;
  for (const key of ["name", "label", "title", "id"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `Score ${index + 1}`;
}

function extractScoreOptions(text: string): readonly ScoreViewerScoreOption[] {
  try {
    const parsed = JSON.parse(text) as { readonly scores?: readonly unknown[] };
    if (!Array.isArray(parsed.scores)) return [];
    return parsed.scores.map((score, index) => ({ index, label: scoreLabel(score, index) }));
  } catch {
    return [];
  }
}

const bootstrap = (window as unknown as { __VIRITURA_MNX_VIEWER__?: ViewerBootstrap }).__VIRITURA_MNX_VIEWER__;
if (!bootstrap) {
  throw new Error("MNX viewer bootstrap data was not provided.");
}

const vscode = acquireVsCodeApi();
const rootElement = document.querySelector<HTMLDivElement>("#root");
if (!rootElement) throw new Error("MNX viewer root element was not found.");

document.documentElement.style.height = "100%";
document.body.style.height = "100%";
document.body.style.margin = "0";
document.body.style.overflow = "hidden";
document.body.style.color = "var(--vscode-editor-foreground)";
document.body.style.background = "var(--vscode-editor-background)";
document.body.style.fontFamily = "var(--vscode-font-family)";
rootElement.style.height = "100%";

function MessagePanel({ title, detail }: { readonly title: string; readonly detail?: string }) {
  return (
    <div style={MESSAGE_PANEL_STYLE}>
      <div style={messageTitleStyle(Boolean(detail))}>{title}</div>
      {detail ? <pre style={MESSAGE_PRE_STYLE}>{detail}</pre> : null}
    </div>
  );
}

function App() {
  const [documentMessage, setDocumentMessage] = useState<DocumentMessage | null>(null);
  const [scoreIndex, setScoreIndex] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<DocumentMessage>) => {
      if (event.data?.type === "document") {
        setDocumentMessage(event.data);
      }
    };
    const handleError = (event: ErrorEvent) => {
      setRuntimeError(errorMessage(event.error ?? event.message));
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      setRuntimeError(errorMessage(event.reason));
    };
    window.addEventListener("message", handleMessage);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    vscode.postMessage({ type: "ready" });
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  const fileName = documentMessage?.fileName ?? bootstrap.fileName;
  const scoreOptions = useMemo(
    () => (documentMessage ? extractScoreOptions(documentMessage.text) : []),
    [documentMessage],
  );

  useEffect(() => {
    if (scoreOptions.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      if (scoreIndex !== 0) setScoreIndex(0);
      return;
    }
    if (!scoreOptions.some((option) => option.index === scoreIndex)) {
      setScoreIndex(scoreOptions[0]?.index ?? 0);
    }
  }, [scoreIndex, scoreOptions]);

  if (runtimeError) {
    return <MessagePanel title="MNX preview crashed" detail={runtimeError} />;
  }

  if (!documentMessage) {
    return <MessagePanel title={`Loading ${fileName}...`} />;
  }

  return (
    <div style={VIEWER_ROOT_STYLE}>
      <ScoreViewer
        mnx={documentMessage.text}
        assetBaseUrl={bootstrap.assetBaseUrl}
        pageWidth={980}
        scoreIndex={scoreIndex}
        onScoreIndexChange={setScoreIndex}
        scoreOptions={scoreOptions}
        defaultViewMode="page"
        availableViewModes={["page", "horizontal", "spread", "spread-horizontal"]}
        defaultFitMode="width"
        controls={{ score: true, viewMode: true, zoom: true, fit: true }}
        controlSurface="floating-status"
        enableCtrlWheelZoom
        style={SCORE_VIEWER_STYLE}
        viewportStyle={VIEWPORT_STYLE}
        loadingFallback={<MessagePanel title={`Loading ${fileName}...`} />}
        errorFallback={(error) => <MessagePanel title="Unable to render MNX" detail={error.message} />}
      />
    </div>
  );
}

createRoot(rootElement).render(<App />);
