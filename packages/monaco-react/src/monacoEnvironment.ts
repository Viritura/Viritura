import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";

interface MonacoEnvironment {
  getWorker(moduleId: string, label: string): Worker;
}

type MonacoGlobal = typeof globalThis & { MonacoEnvironment?: MonacoEnvironment };

export function configureMonacoEnvironment(): void {
  if (typeof Worker === "undefined") return;

  (globalThis as MonacoGlobal).MonacoEnvironment = {
    getWorker(_moduleId, label) {
      return label === "json" ? new JsonWorker() : new EditorWorker();
    },
  };
}

configureMonacoEnvironment();
