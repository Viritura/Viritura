import { afterEach, describe, expect, it } from "vitest";
import { configureMonacoEnvironment } from "./monacoEnvironment";

interface MonacoGlobal {
  MonacoEnvironment?: { getWorker(moduleId: string, label: string): Worker };
}

const monacoGlobal = globalThis as MonacoGlobal;
const originalEnvironment = monacoGlobal.MonacoEnvironment;
const originalWorker = globalThis.Worker;

afterEach(() => {
  monacoGlobal.MonacoEnvironment = originalEnvironment;
  globalThis.Worker = originalWorker;
});

describe("configureMonacoEnvironment", () => {
  it("installs the worker factory when workers are available", () => {
    globalThis.Worker = class {} as typeof Worker;
    monacoGlobal.MonacoEnvironment = undefined;

    configureMonacoEnvironment();

    expect(monacoGlobal.MonacoEnvironment?.getWorker).toBeTypeOf("function");
  });

  it("leaves the environment unchanged during server rendering", () => {
    globalThis.Worker = undefined as unknown as typeof Worker;
    const environment = { getWorker: () => ({}) as Worker };
    monacoGlobal.MonacoEnvironment = environment;

    configureMonacoEnvironment();

    expect(monacoGlobal.MonacoEnvironment).toBe(environment);
  });
});
