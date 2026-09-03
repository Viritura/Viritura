import type * as Monaco from "monaco-editor";

interface JsonValidationWorker {
  doValidation(uri: string): Promise<readonly { readonly severity: number }[]>;
}

type JsonApi = Omit<typeof Monaco.json, "getWorker"> & {
  getWorker(): Promise<(uri: Monaco.Uri) => Promise<JsonValidationWorker>>;
};

export type MonacoApi = Pick<typeof Monaco, "editor" | "languages" | "MarkerSeverity" | "Uri"> & {
  json: JsonApi;
};
export type BeforeMount = (monaco: MonacoApi) => void;
export type OnMount = (editor: Monaco.editor.IStandaloneCodeEditor, monaco: MonacoApi) => void;
export type DiffOnMount = (editor: Monaco.editor.IStandaloneDiffEditor, monaco: MonacoApi) => void;
export type OnValidate = (markers: Monaco.editor.IMarker[], value: string) => void;

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
