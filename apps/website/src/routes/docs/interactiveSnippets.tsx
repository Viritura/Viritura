import { lazy, Suspense, type ComponentType } from "react";

export interface DocSnippetProps {
  readonly id: string;
}

type DocSnippet = ComponentType;

const SNIPPETS: Readonly<Record<string, DocSnippet>> = {
  "editor.percussion-palette": lazy(() => import("./snippets/PercussionPaletteSnippet")),
};

export function DocSnippetHost({ id }: DocSnippetProps) {
  const Snippet = SNIPPETS[id];
  if (!Snippet) {
    return (
      <div className="docs-embed-error" role="alert">
        Interactive example <code>{id}</code> is not available.
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="docs-embed-loading">Loading interactive example…</div>}>
      <Snippet />
    </Suspense>
  );
}
