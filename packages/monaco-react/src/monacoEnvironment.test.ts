import { afterEach, describe, expect, it, vi } from "vitest";

interface MonacoGlobal {
  MonacoEnvironment?: { getWorker(moduleId: string, label: string): Worker };
}

const monacoGlobal = globalThis as MonacoGlobal;
const originalEnvironment = monacoGlobal.MonacoEnvironment;
const originalWorker = globalThis.Worker;

afterEach(() => {
  monacoGlobal.MonacoEnvironment = originalEnvironment;
  globalThis.Worker = originalWorker;
  vi.resetModules();
});

describe("configureMonacoEnvironment", () => {
  it("installs the worker factory as soon as the module loads", async () => {
    globalThis.Worker = class {} as unknown as typeof Worker;
    monacoGlobal.MonacoEnvironment = undefined;

    await import("./monacoEnvironment");

    const environment = monacoGlobal.MonacoEnvironment as MonacoGlobal["MonacoEnvironment"];
    expect(environment?.getWorker).toBeTypeOf("function");
  });

  it("leaves the environment unchanged during server rendering", async () => {
    globalThis.Worker = undefined as unknown as typeof Worker;
    const environment = { getWorker: () => ({}) as Worker };
    monacoGlobal.MonacoEnvironment = environment;

    const { configureMonacoEnvironment } = await import("./monacoEnvironment");
    configureMonacoEnvironment();

    expect(monacoGlobal.MonacoEnvironment).toBe(environment);
  });
});
