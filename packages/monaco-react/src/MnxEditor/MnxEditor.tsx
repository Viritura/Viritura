import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Editor } from "../Editor";
import type { EditorProps, MonacoApi, OnMount, OnValidate } from "../types";
import { configureMnxDiagnostics, loadMnxSchema } from "./diagnostics";

const DEFAULT_MODEL_PATH = "file:///document.mnx";
const ROOT_STYLE: CSSProperties = { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 };
const HEADER_STYLE: CSSProperties = {
  display: "flex",
  flex: "0 0 34px",
  alignItems: "center",
  gap: 12,
  padding: "0 10px",
  fontSize: "var(--type-small-size, 12px)",
  fontWeight: 650,
};
const STATUS_STYLE: CSSProperties = { marginLeft: "auto" };
const EDITOR_STYLE: CSSProperties = { flex: "1 1 auto", minHeight: 0 };
const BASE_OPTIONS: NonNullable<EditorProps["options"]> = {
  automaticLayout: true,
  minimap: { enabled: false },
  tabSize: 2,
  insertSpaces: true,
  scrollBeyondLastLine: false,
  wordWrap: "on",
  formatOnPaste: true,
  renderWhitespace: "none",
};

type ValidationState =
  | { readonly kind: "checking" }
  | { readonly kind: "valid"; readonly source: string }
  | { readonly kind: "invalid"; readonly count: number; readonly source: string }
  | { readonly kind: "unavailable"; readonly message: string };

export interface MnxEditorProps extends Omit<
  EditorProps,
  "beforeMount" | "defaultLanguage" | "language" | "onValidate" | "path"
> {
  title?: ReactNode;
  headerActions?: ReactNode;
  renderHeader?: (status: ReactNode) => ReactNode;
  banner?: ReactNode;
  schemaUrl?: string;
  modelPath?: string;
  onValidate?: OnValidate;
  className?: string;
  style?: CSSProperties;
}

function statusLabel(state: ValidationState): string {
  switch (state.kind) {
    case "checking":
      return "Checking MNX...";
    case "valid":
      return "Valid MNX";
    case "invalid":
      return `${state.count} validation error${state.count === 1 ? "" : "s"}`;
    case "unavailable":
      return "Unable to check MNX";
  }
}

function statusColor(state: ValidationState, dark: boolean): string {
  switch (state.kind) {
    case "checking":
      return dark ? "#969696" : "#616161";
    case "valid":
      return dark ? "#4ec9b0" : "#16825d";
    case "invalid":
    case "unavailable":
      return dark ? "#f48771" : "#c42b1c";
  }
}

export function MnxEditor({
  title = "MNX Source",
  headerActions,
  renderHeader,
  banner,
  schemaUrl = "/mnx-schema.json",
  modelPath = DEFAULT_MODEL_PATH,
  onValidate,
  className,
  style,
  options,
  theme = "vs-dark",
  value,
  defaultValue,
  onChange,
  onMount,
  ...editorProps
}: MnxEditorProps) {
  const [loadedSchema, setLoadedSchema] = useState<{
    readonly url: string;
    readonly value: Record<string, unknown>;
  } | null>(null);
  const [validation, setValidation] = useState<ValidationState>({ kind: "checking" });
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<MonacoApi | null>(null);
  const validationRequestRef = useRef(0);
  const source = value ?? defaultValue ?? "";
  const schema = loadedSchema?.url === schemaUrl ? loadedSchema.value : null;
  const visibleValidation =
    (validation.kind === "valid" || validation.kind === "invalid") && validation.source !== source
      ? { kind: "checking" as const }
      : validation;
  const dark = theme.toLowerCase().includes("dark");
  const mergedOptions = useMemo(() => ({ ...BASE_OPTIONS, ...options }), [options]);
  const rootStyle = { ...ROOT_STYLE, ...style };
  const headerStyle = {
    ...HEADER_STYLE,
    color: dark ? "#cccccc" : "#333333",
    borderBottom: `1px solid ${dark ? "#3c3c3c" : "#d4d4d4"}`,
    background: dark ? "#252526" : "#f3f3f3",
  };
  const validationStatusStyle = { ...STATUS_STYLE, color: statusColor(visibleValidation, dark) };

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a schema URL change starts a new asynchronous validation cycle
    setValidation({ kind: "checking" });
    void loadMnxSchema(schemaUrl).then(
      (loadedSchema) => {
        if (active) setLoadedSchema({ url: schemaUrl, value: loadedSchema });
      },
      (error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Unable to load the MNX schema";
        setValidation({ kind: "unavailable", message });
      },
    );
    return () => {
      active = false;
    };
  }, [schemaUrl]);

  const validateModel = useEffectEvent(async (monaco: MonacoApi): Promise<void> => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!schema || !model) return;
    const request = ++validationRequestRef.current;
    const validatedSource = model.getValue();
    try {
      const workerAccessor = await monaco.json.getWorker();
      const worker = await workerAccessor(model.uri);
      const diagnostics = await worker.doValidation(model.uri.toString());
      if (request !== validationRequestRef.current || model.getValue() !== validatedSource) return;
      const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity >= monaco.MarkerSeverity.Error).length;
      setValidation(
        errorCount === 0
          ? { kind: "valid", source: validatedSource }
          : { kind: "invalid", count: errorCount, source: validatedSource },
      );
    } catch (error: unknown) {
      if (request !== validationRequestRef.current) return;
      const message = error instanceof Error ? error.message : "The MNX validation worker failed";
      setValidation({ kind: "unavailable", message });
    }
  });

  useEffect(() => {
    if (monacoRef.current) void validateModel(monacoRef.current);
  }, [schema, source]);

  const handleMarkerValidation: OnValidate = (markers, validatedSource) => {
    onValidate?.(markers, validatedSource);
    if (!schema || validatedSource !== source) return;
    validationRequestRef.current++;
    const errorCount = markers.length;
    setValidation(
      errorCount === 0
        ? { kind: "valid", source: validatedSource }
        : { kind: "invalid", count: errorCount, source: validatedSource },
    );
  };

  const status = (
    <span
      style={validationStatusStyle}
      data-state={visibleValidation.kind}
      title={visibleValidation.kind === "unavailable" ? visibleValidation.message : undefined}
    >
      {statusLabel(visibleValidation)}
    </span>
  );

  return (
    <div className={className} style={rootStyle}>
      {renderHeader ? (
        renderHeader(status)
      ) : (
        <div style={headerStyle}>
          <span>{title}</span>
          {status}
          {headerActions}
        </div>
      )}
      {banner}
      <div style={EDITOR_STYLE}>
        <Editor
          key={schema ? schemaUrl : "loading"}
          {...editorProps}
          path={modelPath}
          language="json"
          value={value}
          defaultValue={defaultValue}
          theme={theme}
          beforeMount={(monaco) => {
            monacoRef.current = monaco;
            if (schema) configureMnxDiagnostics(monaco, schema);
          }}
          onChange={(nextValue, event) => {
            onChange?.(nextValue, event);
          }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            onMount?.(editor, monaco);
          }}
          onValidate={handleMarkerValidation}
          options={mergedOptions}
        />
      </div>
    </div>
  );
}
