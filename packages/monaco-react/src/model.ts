import type { editor, Uri } from "monaco-editor";

export interface InitialEditorConfig {
  value: string;
  language?: string;
  path?: string;
}

export interface ModelApi {
  Uri: { parse(path: string): Uri };
  editor: {
    getModel(uri: Uri): editor.ITextModel | null;
    createModel(value: string, language?: string, uri?: Uri): editor.ITextModel;
  };
}

export function acquireModel(api: ModelApi, config: InitialEditorConfig): { model: editor.ITextModel; owned: boolean } {
  if (config.path) {
    const uri = api.Uri.parse(config.path);
    const existing = api.editor.getModel(uri);
    if (existing) return { model: existing, owned: false };
    return { model: api.editor.createModel(config.value, config.language, uri), owned: true };
  }
  return { model: api.editor.createModel(config.value, config.language), owned: true };
}
