import { useMemo, useState, type CSSProperties } from "react";
import { Editor, type BeforeMount, type OnValidate } from "@viritura/monaco-react";
import { configureMnxDiagnostics } from "../../mnx-schema";

const EDITOR_WRAPPER_STYLE: CSSProperties = { display: "flex", flexDirection: "column", height: 600 };
const EDITOR_HOST_STYLE: CSSProperties = { flex: "1 1 auto", minHeight: 0 };

interface MonacoMnxViewerProps {
  data: unknown;
}

export function MonacoMnxViewer({ data }: MonacoMnxViewerProps) {
  const json = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const [validation, setValidation] = useState<{ readonly source: string; readonly markerCount: number } | null>(null);
  const markerCount = validation?.source === json ? validation.markerCount : null;

  const handleBeforeMount: BeforeMount = (monaco) => {
    configureMnxDiagnostics(monaco);
  };
  const handleValidate: OnValidate = (markers, source) => setValidation({ source, markerCount: markers.length });

  return (
    <div style={EDITOR_WRAPPER_STYLE}>
      <div className={`validation-summary ${markerCount === null ? "" : markerCount === 0 ? "valid" : "invalid"}`}>
        {markerCount === null
          ? "Checking MNX document..."
          : markerCount === 0
            ? "Valid MNX document"
            : `${markerCount} validation error${markerCount === 1 ? "" : "s"}`}
      </div>
      <div style={EDITOR_HOST_STYLE}>
        <Editor
          defaultLanguage="json"
          value={json}
          beforeMount={handleBeforeMount}
          onValidate={handleValidate}
          theme="vs"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            // Monaco requires a numeric font size; not part of the --site-type-* chrome scale.
            fontSize: 12,
            lineNumbers: "on",
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            renderWhitespace: "none",
          }}
        />
      </div>
    </div>
  );
}
