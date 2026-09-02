import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { PanelHeader } from "@viritura/ui";
import { Editor, type BeforeMount } from "@viritura/monaco-react";
import { useDocument, useDocumentActions } from "../store/DocumentContext";
import { parseMnxWithDiagnostics } from "@viritura/format";
import { configureMnxJsonDiagnostics, loadMnxSchema } from "../lib/monacoMnxSchema";

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
  const mnxSchemaRef = useRef<Record<string, unknown> | null>(null);
  const monacoRef = useRef<Parameters<BeforeMount>[0] | null>(null);
  const suppressSyncRef = useRef(false);

  // Load MNX JSON Schema for Monaco validation
  useEffect(() => {
    loadMnxSchema().then((schema) => {
      mnxSchemaRef.current = schema;
      if (monacoRef.current) {
        configureMnxJsonDiagnostics(monacoRef.current, schema);
      }
    });
  }, []);

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

  // Configure Monaco JSON language service with MNX schema
  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    configureMnxJsonDiagnostics(monaco, mnxSchemaRef.current);
  };

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
      {/* Header */}
      <PanelHeader title="MNX Source" onClose={onClose} closeIcon={<X size={14} />} />

      {/* Error bar */}
      {error && <div style={MNX_SOURCE_ERROR_STYLE}>{error}</div>}

      {/* Monaco editor */}
      <div style={MNX_SOURCE_EDITOR_STYLE}>
        <Editor
          defaultLanguage="json"
          value={localText}
          onChange={handleChange}
          beforeMount={handleBeforeMount}
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
