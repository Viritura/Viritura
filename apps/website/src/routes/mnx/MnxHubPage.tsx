import { useEffect } from "react";
import { ActionTile, Button, Text } from "@viritura/ui";
import "./mnxHub.css";

const marketplaceUrl = "https://marketplace.visualstudio.com/items?itemName=Viritura.mnx-viewer";
const mnxDocsUrl = "https://www.w3.org/community/music-notation/wiki/MNX";
const githubUrl = "https://github.com/Viritura/Viritura";

function mnxExamplesUrl(): string {
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
          <ActionTile
            title="MNX Examples"
            hint="Browse standard MNX, Viritura extensions, and public engraving-behavior examples."
            onClick={() => window.location.assign(mnxExamplesUrl())}
          />
          <ActionTile
            title="MNX Playground"
            hint="Edit a document and inspect live output from Viritura's Rust and WebAssembly engraving engine."
            onClick={() => window.location.assign("/mnx/playground")}
          />
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
          <Button variant="default" onClick={() => window.location.assign(mnxDocsUrl)}>
            W3C MNX documentation
          </Button>
          <Button variant="default" onClick={() => window.location.assign(githubUrl)}>
            Viritura on GitHub
          </Button>
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
        <Button variant="primary" onClick={() => window.location.assign(marketplaceUrl)}>
          View in the Marketplace
        </Button>
      </section>
    </div>
  );
}
