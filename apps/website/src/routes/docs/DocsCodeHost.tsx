import { lazy, Suspense, type ComponentType } from "react";

interface CodeSampleProps {
  readonly source: string;
  readonly fence: string;
  readonly host: HTMLElement;
}

function PlainCodeSample() {
  return null;
}

// A failed chunk load (offline, blocked asset) leaves the server-rendered <pre>.
const DocsCodeBlock = lazy<ComponentType<CodeSampleProps>>(() =>
  import("./DocsCodeBlock").catch((error: unknown) => {
    console.warn("Code sample editor failed to load:", error);
    return { default: PlainCodeSample };
  }),
);

interface DocsCodeHostProps {
  readonly host: HTMLElement;
  readonly source: string;
  readonly fence: string;
}

/**
 * Upgrades a server-rendered code sample to a read-only Monaco view. The
 * original `<pre>` stays visible until Monaco has loaded, so the sample reads
 * the same without JavaScript and the page doesn't jump.
 */
export function DocsCodeHost({ host, source, fence }: DocsCodeHostProps) {
  return (
    <Suspense fallback={null}>
      <DocsCodeBlock source={source} fence={fence} host={host} />
    </Suspense>
  );
}
