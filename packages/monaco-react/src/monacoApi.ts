import * as editorApi from "monaco-editor/esm/vs/editor/editor.api.js";
import * as json from "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import type { MonacoApi } from "./types";

export const monaco = { ...editorApi, json: json as unknown as MonacoApi["json"] } as MonacoApi;
