import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

interface MonacoEnvironment {
  getWorker(moduleId: string, label: string): Worker;
}

type MonacoGlobal = typeof globalThis & { MonacoEnvironment?: MonacoEnvironment };

if (typeof Worker !== "undefined") {
  (globalThis as MonacoGlobal).MonacoEnvironment = {
    getWorker(_moduleId, label) {
      return label === "json" ? new JsonWorker() : new EditorWorker();
    },
  };
}
