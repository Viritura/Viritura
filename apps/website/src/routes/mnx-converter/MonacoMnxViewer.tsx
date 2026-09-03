import { useMemo, type CSSProperties } from "react";
import { MnxEditor } from "@viritura/monaco-react";

const EDITOR_WRAPPER_STYLE: CSSProperties = { display: "flex", flexDirection: "column", height: 600 };
const EDITOR_HOST_STYLE: CSSProperties = { flex: "1 1 auto", minHeight: 0 };

interface MonacoMnxViewerProps {
  data: unknown;
}

export function MonacoMnxViewer({ data }: MonacoMnxViewerProps) {
  const json = useMemo(() => JSON.stringify(data, null, 2), [data]);
  return (
    <div style={EDITOR_WRAPPER_STYLE}>
      <div style={EDITOR_HOST_STYLE}>
        <MnxEditor
          title="MNX document"
          modelPath="file:///converted.mnx"
          value={json}
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
