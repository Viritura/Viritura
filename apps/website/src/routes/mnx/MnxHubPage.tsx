import { useEffect } from "react";
import { ActionTile, Button, Text } from "@viritura/ui";
import { ScoreViewer } from "@viritura/score-viewer-react";
import { mnxHeroSample } from "./mnxHeroSample";
import "./mnxHub.css";

const marketplaceUrl = "https://marketplace.visualstudio.com/items?itemName=Viritura.mnx-viewer";
const mnxDocsUrl = "https://w3c-cg.github.io/mnx/docs/";
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
            Open music notation, made tangible
          </Text>
          <Text as="h1" variant="display">
            MNX, rendered in the open.
          </Text>
          <Text as="p" variant="body" tone="muted">
            Read the source, edit the document, and see the engraved result in one browser. Viritura makes MNX practical
            to understand, test, and adopt.
          </Text>
          <div className="mnx-hub__intro-actions">
            <Button variant="primary" onClick={() => window.location.assign("/mnx/playground")}>
              Open the MNX Playground
            </Button>
            <Button variant="default" onClick={() => window.location.assign(mnxExamplesUrl())}>
              Browse examples
            </Button>
          </div>
          <p className="mnx-hub__proof">W3C community format · JSON source · Open-source engraving engine</p>
        </div>
        <div className="mnx-hub__intro-visual">
          <div className="mnx-hub__preview-bar">
            <span>Interactive MNX sample</span>
            <span>Zoom · Fit · Inspect</span>
          </div>
          <ScoreViewer
            mnx={mnxHeroSample}
            pageWidth={0}
            pageHeight={0}
            spatium={10}
            viewMode="horizontal"
            defaultFitMode="width"
            controls={{ score: false, viewMode: false, zoom: true, fit: true }}
            controlSurface="floating-status"
            enableCtrlWheelZoom
            className="mnx-hub__score-viewer"
            viewportClassName="mnx-hub__score-viewport"
            scoreClassName="mnx-score-surface"
            pageBackground="transparent"
            loadingFallback={<div className="mnx-hub__score-message">Engraving MNX...</div>}
            errorFallback={() => <div className="mnx-hub__score-message">Unable to render the sample.</div>}
          />
        </div>
      </header>

      <section className="mnx-hub__projects" aria-labelledby="mnx-projects-title">
        <div className="mnx-hub__section-heading">
          <Text as="p" variant="eyebrow" tone="muted">
            Start with the format
          </Text>
          <Text as="h2" id="mnx-projects-title" variant="title">
            From first look to working document.
          </Text>
          <Text as="p" variant="body" tone="muted">
            Use a curated example, edit MNX directly, or convert an existing score. Each path ends with notation you can
            inspect, render, and keep.
          </Text>
        </div>
        <div className="mnx-hub__project-grid">
          <ActionTile
            className="mnx-hub__project"
            title="Learn from examples"
            hint="Browse focused documents for standard MNX, documented Viritura extensions, and engraving behavior."
            onClick={() => window.location.assign(mnxExamplesUrl())}
          />
          <ActionTile
            className="mnx-hub__project"
            variant="recommended"
            title="Edit and render live"
            hint="Change a document and inspect output from Viritura's Rust and WebAssembly engraving engine."
            onClick={() => window.location.assign("/mnx/playground")}
          />
          <ActionTile
            className="mnx-hub__project"
            title="Bring a MusicXML score"
            hint="Convert MusicXML or compressed MXL to MNX locally, review the result, and download the open document."
            onClick={() => window.location.assign("/mnx/mxl-converter")}
          />
        </div>
      </section>

      <section className="mnx-hub__relationship" aria-labelledby="mnx-relationship-title">
        <div>
          <Text as="p" variant="eyebrow" tone="muted">
            A clear boundary
          </Text>
          <Text as="h2" id="mnx-relationship-title" variant="title">
            The format stays open. Our choices stay visible.
          </Text>
          <Text as="p" variant="body" tone="muted">
            Viritura stores scores as MNX. When a notation concept is not yet covered by the format, we keep it in the
            documented <code>_x.viritura</code> extension namespace instead of changing the standard document model.
            Separate examples identify Viritura&rsquo;s engraving choices so they are never mistaken for MNX
            requirements.
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
          <Text as="p" variant="eyebrow" tone="muted">
            Keep MNX close to the code
          </Text>
          <Text as="h2" id="mnx-vscode-title" variant="title">
            Preview MNX without leaving VS Code.
          </Text>
          <Text as="p" variant="body" tone="muted">
            Open a <code>.mnx</code> file beside its rendered score. The viewer bundles the WebAssembly engine and music
            fonts, so local previews continue to work offline.
          </Text>
        </div>
        <Button variant="primary" onClick={() => window.location.assign(marketplaceUrl)}>
          View in the Marketplace
        </Button>
      </section>
    </div>
  );
}
