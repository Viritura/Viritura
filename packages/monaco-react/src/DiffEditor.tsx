import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import { monaco } from "./monacoApi";
import type { DiffEditorProps } from "./types";

const ROOT_STYLE = { width: "100%", height: "100%" } as const;

export function DiffEditor(props: DiffEditorProps) {
  const { beforeMount, language, modified, onMount, options, original, theme } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<editor.ITextModel | null>(null);
  const [initialConfig] = useState(() => ({ original: original ?? "", modified: modified ?? "", language }));
  const callBeforeMount = useEffectEvent(() => beforeMount?.(monaco));
  const callOnMount = useEffectEvent((editor: editor.IStandaloneDiffEditor) => onMount?.(editor, monaco));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    callBeforeMount();
    const originalModel = monaco.editor.createModel(initialConfig.original, initialConfig.language);
    const modifiedModel = monaco.editor.createModel(initialConfig.modified, initialConfig.language);
    originalModelRef.current = originalModel;
    modifiedModelRef.current = modifiedModel;
    const editor = monaco.editor.createDiffEditor(container);
    editor.setModel({ original: originalModel, modified: modifiedModel });
    editorRef.current = editor;
    callOnMount(editor);

    return () => {
      editor.dispose();
      editorRef.current = null;
      originalModel.dispose();
      modifiedModel.dispose();
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, [initialConfig]);

  useEffect(() => {
    const model = originalModelRef.current;
    if (model && original !== undefined && model.getValue() !== original) model.setValue(original);
  }, [original]);

  useEffect(() => {
    const model = modifiedModelRef.current;
    if (model && modified !== undefined && model.getValue() !== modified) model.setValue(modified);
  }, [modified]);

  useEffect(() => {
    if (theme) monaco.editor.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (options) editorRef.current?.updateOptions(options);
  }, [options]);

  return <div ref={containerRef} style={ROOT_STYLE} />;
}
