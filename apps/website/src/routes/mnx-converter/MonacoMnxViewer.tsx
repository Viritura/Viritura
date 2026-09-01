import { useMemo, type CSSProperties } from "react";
import Editor, { type BeforeMount } from "@monaco-editor/react";
import { configureMnxDiagnostics } from "../../mnx-schema";

const EDITOR_WRAPPER_STYLE: CSSProperties = { height: 600 };

interface MonacoMnxViewerProps {
  data: unknown;
}

export function MonacoMnxViewer({ data }: MonacoMnxViewerProps) {
  const json = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    configureMnxDiagnostics(monaco);
  };

  return (
    <div style={EDITOR_WRAPPER_STYLE}>
      <Editor
        defaultLanguage="json"
        value={json}
        beforeMount={handleBeforeMount}
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
  );
}
