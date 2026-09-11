import { configureMonacoEnvironment } from "./monacoEnvironment";
import * as editorApi from "monaco-editor/editor/editor.api.js";
// @ts-expect-error -- Monaco 0.56 exports this runtime module without a declaration file.
import * as json from "monaco-editor/language/json/monaco.contribution.js";
import type { MonacoApi } from "./types";

// Keep the environment import live and ordered before Monaco initializes its worker factory.
configureMonacoEnvironment();

export const monaco = { ...editorApi, json: json as unknown as MonacoApi["json"] } as MonacoApi;
