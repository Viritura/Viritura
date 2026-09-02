import { describe, expect, it, vi } from "vitest";
import type { editor, Uri } from "monaco-editor";
import { acquireModel, type ModelApi } from "./model";

function modelApi(existing: editor.ITextModel | null = null) {
  const uri = { toString: () => "file:///score.mnx" } as Uri;
  const created = {} as editor.ITextModel;
  const api: ModelApi = {
    Uri: { parse: vi.fn(() => uri) },
    editor: {
      getModel: vi.fn(() => existing),
      createModel: vi.fn(() => created),
    },
  };
  return { api, created, uri };
}

describe("acquireModel", () => {
  it("reuses a named model without taking disposal ownership", () => {
    const existing = {} as editor.ITextModel;
    const { api } = modelApi(existing);

    expect(acquireModel(api, { value: "new", language: "json", path: "file:///score.mnx" })).toEqual({
      model: existing,
      owned: false,
    });
    expect(api.editor.createModel).not.toHaveBeenCalled();
  });

  it("creates and owns a missing named model", () => {
    const { api, created, uri } = modelApi();

    expect(acquireModel(api, { value: "{}", language: "json", path: "file:///score.mnx" })).toEqual({
      model: created,
      owned: true,
    });
    expect(api.editor.createModel).toHaveBeenCalledWith("{}", "json", uri);
  });

  it("creates and owns an anonymous model", () => {
    const { api, created } = modelApi();

    expect(acquireModel(api, { value: "{}", language: "json" })).toEqual({ model: created, owned: true });
    expect(api.editor.createModel).toHaveBeenCalledWith("{}", "json");
  });
});
