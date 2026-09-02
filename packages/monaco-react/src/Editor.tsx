import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import { monaco } from "./monacoApi";
import "./monacoEnvironment";
import type { EditorProps } from "./types";

const ROOT_STYLE = { width: "100%", height: "100%" } as const;

interface InitialEditorConfig {
  value: string;
  language?: string;
  path?: string;
}

function getModel(config: InitialEditorConfig): { model: editor.ITextModel; owned: boolean } {
  if (config.path) {
    const uri = monaco.Uri.parse(config.path);
    const existing = monaco.editor.getModel(uri);
    if (existing) return { model: existing, owned: false };
    return {
      model: monaco.editor.createModel(config.value, config.language, uri),
      owned: true,
    };
  }
  return {
    model: monaco.editor.createModel(config.value, config.language),
    owned: true,
  };
}

export function Editor(props: EditorProps) {
  const {
    beforeMount,
    defaultLanguage,
    defaultValue,
    language,
    onChange,
    onMount,
    onValidate,
    options,
    path,
    theme,
    value,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const suppressChangeRef = useRef(false);
  const [initialConfig] = useState<InitialEditorConfig>(() => ({
    value: value ?? defaultValue ?? "",
    language: language ?? defaultLanguage,
    path,
  }));
  const callBeforeMount = useEffectEvent(() => beforeMount?.(monaco));
  const callOnMount = useEffectEvent((editor: editor.IStandaloneCodeEditor) => onMount?.(editor, monaco));
  const callOnChange = useEffectEvent((nextValue: string, event: editor.IModelContentChangedEvent) =>
    onChange?.(nextValue, event),
  );
  const callOnValidate = useEffectEvent((markers: editor.IMarker[]) => onValidate?.(markers));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    callBeforeMount();
    const { model, owned } = getModel(initialConfig);
    const editor = monaco.editor.create(container, { model });
    editorRef.current = editor;
    const contentSubscription = editor.onDidChangeModelContent((event) => {
      if (!suppressChangeRef.current) callOnChange(editor.getValue(), event);
    });
    const markerSubscription = monaco.editor.onDidChangeMarkers((resources) => {
      if (resources.some((resource) => resource.toString() === model.uri.toString())) {
        callOnValidate(monaco.editor.getModelMarkers({ resource: model.uri }));
      }
    });
    callOnMount(editor);

    return () => {
      markerSubscription.dispose();
      contentSubscription.dispose();
      editor.dispose();
      editorRef.current = null;
      if (owned && !model.isDisposed()) model.dispose();
    };
  }, [initialConfig]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === undefined || editor.getValue() === value) return;
    suppressChangeRef.current = true;
    editor.setValue(value);
    suppressChangeRef.current = false;
  }, [value]);

  useEffect(() => {
    if (theme) monaco.editor.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (options) editorRef.current?.updateOptions(options);
  }, [options]);

  return <div ref={containerRef} style={ROOT_STYLE} />;
}
