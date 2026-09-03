import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import { monaco } from "./monacoApi";
import type { EditorProps } from "./types";
import { acquireModel, type InitialEditorConfig } from "./model";

const ROOT_STYLE = { width: "100%", height: "100%" } as const;

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
  const callOnValidate = useEffectEvent((markers: editor.IMarker[], validatedValue: string) =>
    onValidate?.(markers, validatedValue),
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    callBeforeMount();
    const { model, owned } = acquireModel(monaco, initialConfig);
    const editor = monaco.editor.create(container, { model });
    editorRef.current = editor;
    const contentSubscription = editor.onDidChangeModelContent((event) => {
      if (!suppressChangeRef.current) callOnChange(editor.getValue(), event);
    });
    const markerSubscription = monaco.editor.onDidChangeMarkers((resources) => {
      if (resources.some((resource) => resource.toString() === model.uri.toString())) {
        callOnValidate(monaco.editor.getModelMarkers({ resource: model.uri }), model.getValue());
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
