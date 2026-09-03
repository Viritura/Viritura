import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { PanelHeader } from "@viritura/ui";
import { MnxEditor } from "@viritura/monaco-react";
import { useDocument, useDocumentActions } from "../store/DocumentContext";
import { parseMnxWithDiagnostics } from "@viritura/format";

const MNX_SOURCE_PANEL_ROOT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  borderLeft: "none",
  background: "var(--surface-sunken)",
  boxShadow: "var(--shadow-panel-r)",
};
const MNX_SOURCE_ERROR_STYLE: CSSProperties = {
  padding: "0.3rem 0.75rem",
  fontSize: "var(--type-eyebrow-size)",
  background: "var(--surface-raised)",
  color: "var(--warning)",
  borderBottom: "none",
  boxShadow: "var(--inset-soft), inset 0 0 0 1px var(--warning)",
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
};
const MNX_SOURCE_EDITOR_STYLE: CSSProperties = { flex: 1 };

interface MnxSourcePanelProps {
  /** Called to close the panel */
  onClose: () => void;
}

/**
 * Side panel showing the raw MNX JSON for the current score.
 *
 * Reads from DocumentContext and writes back on change (debounced).
 * Edits in the text editor update the rendered score in real time.
 */
export function MnxSourcePanel({ onClose }: MnxSourcePanelProps) {
  const { mnxJson } = useDocument();
  const { updateScore } = useDocumentActions();
  const [localText, setLocalText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressSyncRef = useRef(false);

  // Sync from DocumentContext → local text (when score changes externally)
  useEffect(() => {
    if (suppressSyncRef.current) {
      suppressSyncRef.current = false;
      return;
    }
    if (!mnxJson) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setLocalText("");
      return;
    }
    try {
      const pretty = JSON.stringify(JSON.parse(mnxJson), null, 2);
      setLocalText(pretty);
      setError(null);
    } catch {
      setLocalText(mnxJson);
    }
  }, [mnxJson]);

  // Debounced push to DocumentContext
  const handleChange = useCallback(
    (value: string | undefined) => {
      const text = value ?? "";
      setLocalText(text);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try {
          const parsed = JSON.parse(text);
          const score = parseMnxWithDiagnostics(parsed).score;
          suppressSyncRef.current = true;
          updateScore(score);
          setError(null);
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }, 500);
    },
    [updateScore],
  );

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  return (
    <div style={MNX_SOURCE_PANEL_ROOT_STYLE}>
      {/* Monaco editor */}
      <div style={MNX_SOURCE_EDITOR_STYLE}>
        <MnxEditor
          modelPath="file:///app-source.mnx"
          schemaUrl={`${import.meta.env.BASE_URL}mnx-schema.json`}
          value={localText}
          onChange={handleChange}
          renderHeader={(status) => (
            <PanelHeader title="MNX Source" actions={status} onClose={onClose} closeIcon={<X size={14} />} />
          )}
          banner={error ? <div style={MNX_SOURCE_ERROR_STYLE}>{error}</div> : undefined}
          theme="vs-light"
          options={{
            minimap: { enabled: false },
            // Monaco option requires a numeric font size.
            fontSize: 12,
            lineNumbers: "on",
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            formatOnPaste: true,
            renderWhitespace: "none",
          }}
        />
      </div>
    </div>
  );
}
