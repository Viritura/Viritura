import { useEffect } from "react";
import { Text } from "@viritura/ui";
import "./mnxHub.css";

const marketplaceUrl = "https://marketplace.visualstudio.com/items?itemName=Viritura.mnx-viewer";
const mnxDocsUrl = "https://www.w3.org/community/music-notation/wiki/MNX";
const githubUrl = "https://github.com/Viritura/Viritura";

function mnxExamplesUrl(): string {
  if (typeof window === "undefined") return "/mnx/examples/";
  const { host, protocol } = window.location;
  if (import.meta.env.DEV && host.startsWith("web.") && host.endsWith(".localhost")) {
    return `${protocol}//${host.replace(/^web\./, "mnx.")}`;
  }
  return "/mnx/examples/";
}

export function MnxHubPage() {
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("path")) return;
    window.location.replace(`/mnx/examples/${window.location.search}`);
  }, []);

  return (
    <div className="mnx-hub">
      <header className="mnx-hub__intro">
        <div className="mnx-hub__intro-copy">
          <Text as="p" variant="eyebrow" tone="muted">
            Open music notation
          </Text>
          <Text as="h1" variant="display">
            MNX
          </Text>
          <Text as="p" variant="body" tone="muted">
            Viritura provides interactive examples and browser-based tools that help developers explore the format,
            verify rendering behavior, and adopt MNX with confidence.
          </Text>
        </div>
      </header>

      <section className="mnx-hub__projects" aria-labelledby="mnx-projects-title">
        <Text as="h2" id="mnx-projects-title" variant="title">
          Explore MNX in the browser
        </Text>
        <div className="mnx-hub__project-grid">
          <a className="mnx-hub__project" href={mnxExamplesUrl()}>
            <h3>MNX Examples</h3>
            <p>Browse standard MNX, Viritura extensions, and public engraving-behavior examples.</p>
          </a>
          <a className="mnx-hub__project" href="/mnx/playground">
            <h3>MNX Playground</h3>
            <p>Edit a document and inspect live output from Viritura&rsquo;s Rust and WebAssembly engraving engine.</p>
          </a>
          <a className="mnx-hub__project" href="/mnx/mxl-converter">
            <h3>MusicXML converter</h3>
            <p>Convert MusicXML and compressed MXL files to MNX without uploading the source score.</p>
          </a>
        </div>
      </section>

      <section className="mnx-hub__relationship" aria-labelledby="mnx-relationship-title">
        <div>
          <Text as="h2" id="mnx-relationship-title" variant="title">
            Standards first, extensions in the open
          </Text>
          <Text as="p" variant="body" tone="muted">
            Viritura implements standard MNX and uses the documented <code>_x.viritura</code> namespace for notation the
            format does not yet cover. Engraving-behavior examples describe Viritura&rsquo;s implementation choices, not
            requirements of the MNX format.
          </Text>
        </div>
        <div className="mnx-hub__links">
          <a className="btn btn-secondary" href={mnxDocsUrl}>
            W3C MNX documentation
          </a>
          <a className="btn btn-secondary" href={githubUrl}>
            Viritura on GitHub
          </a>
        </div>
      </section>

      <section className="mnx-hub__vscode" aria-labelledby="mnx-vscode-title">
        <div>
          <Text as="h2" id="mnx-vscode-title" variant="title">
            MNX Viewer for VS Code
          </Text>
          <Text as="p" variant="body" tone="muted">
            Open and preview <code>.mnx</code> files locally, including offline rendering with bundled WebAssembly and
            music fonts.
          </Text>
        </div>
        <a className="btn btn-primary" href={marketplaceUrl}>
          View in the Marketplace
        </a>
      </section>
    </div>
  );
}
