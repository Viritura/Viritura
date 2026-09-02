import type * as Monaco from "monaco-editor";

export type MonacoApi = Pick<typeof Monaco, "editor" | "json" | "languages" | "MarkerSeverity" | "Uri">;
export type BeforeMount = (monaco: MonacoApi) => void;
export type OnMount = (editor: Monaco.editor.IStandaloneCodeEditor, monaco: MonacoApi) => void;
export type DiffOnMount = (editor: Monaco.editor.IStandaloneDiffEditor, monaco: MonacoApi) => void;
export type OnValidate = (markers: Monaco.editor.IMarker[]) => void;

export interface EditorProps {
  value?: string;
  defaultValue?: string;
  language?: string;
  defaultLanguage?: string;
  path?: string;
  theme?: string;
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;
  beforeMount?: BeforeMount;
  onMount?: OnMount;
  onChange?: (value: string | undefined, event: Monaco.editor.IModelContentChangedEvent) => void;
  onValidate?: OnValidate;
}

export interface DiffEditorProps {
  original?: string;
  modified?: string;
  language?: string;
  theme?: string;
  options?: Monaco.editor.IStandaloneDiffEditorConstructionOptions;
  beforeMount?: BeforeMount;
  onMount?: DiffOnMount;
}
