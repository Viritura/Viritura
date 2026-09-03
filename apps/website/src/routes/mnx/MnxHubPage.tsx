import { useEffect, useState } from "react";
import { Text } from "@viritura/ui";
import { ScoreViewer } from "@viritura/score-viewer-react";
import { mnxHeroSample } from "./mnxHeroSample";
import { MnxGuide } from "./MnxGuide";
import "./mnxHub.css";

const marketplaceUrl = "https://marketplace.visualstudio.com/items?itemName=Viritura.mnx-viewer";
const mnxDocsUrl = "https://w3c-cg.github.io/mnx/docs/";
const githubUrl = "https://github.com/Viritura/Viritura";
const mnxHeroSource = JSON.stringify(mnxHeroSample, null, 2);

export function MnxHubPage({ appUrl }: { readonly appUrl: string }) {
  const [hasPaintedSample, setHasPaintedSample] = useState(false);

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
            <a className="btn btn-primary" href="/mnx/playground">
              Open the Playground
            </a>
            <a className="btn btn-secondary" href="/mnx/examples">
              Browse the full library
            </a>
          </div>
          <p className="mnx-hub__proof">W3C community format · JSON source · Open-source engraving engine</p>
        </div>
        <div className="mnx-hub__intro-visual">
          <div className="mnx-hub__preview-bar">
            <span className="mnx-hub__render-status" aria-live="polite">
              <span className="mnx-hub__render-status-dot" data-active={hasPaintedSample} aria-hidden="true" />
              {hasPaintedSample ? "Live engine output" : "Engraving in browser"}
            </span>
            <span className="mnx-hub__render-pipeline">MNX → Rust/WASM → Canvas</span>
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
            onPaint={() => setHasPaintedSample(true)}
          />
          <details className="mnx-hub__source">
            <summary>
              <span className="mnx-hub__source-show">Show code</span>
              <span className="mnx-hub__source-hide">Hide code</span>
            </summary>
            <pre>
              <code>{mnxHeroSource}</code>
            </pre>
          </details>
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
            Edit the MNX documentation examples in the Playground, browse the broader example library, or convert an
            existing score. Each path ends with notation you can inspect, render, and keep.
          </Text>
        </div>
        <div className="mnx-hub__project-grid">
          <a className="mnx-hub__project" href="/mnx/examples">
            <span className="mnx-hub__project-kicker">Browse</span>
            <span className="mnx-hub__project-title">Example library</span>
            <span className="mnx-hub__project-hint">
              Explore the larger Storybook catalog of standard MNX, Viritura extensions, and engraving behavior.
            </span>
            <span className="mnx-hub__project-action">Open the library →</span>
          </a>
          <a className="mnx-hub__project mnx-hub__project--primary" href="/mnx/playground">
            <span className="mnx-hub__project-kicker">Edit live</span>
            <span className="mnx-hub__project-title">MNX Playground</span>
            <span className="mnx-hub__project-hint">
              Choose the featured sample or one of 52 MNX documentation examples, then change the source and inspect the
              live engraving.
            </span>
            <span className="mnx-hub__project-action">Open the Playground →</span>
          </a>
          <a className="mnx-hub__project" href="/mnx/mxl-converter">
            <span className="mnx-hub__project-kicker">Convert</span>
            <span className="mnx-hub__project-title">MusicXML to MNX</span>
            <span className="mnx-hub__project-hint">
              Convert MusicXML or compressed MXL locally, review the result, and download the open document.
            </span>
            <span className="mnx-hub__project-action">Open the converter →</span>
          </a>
          <a className="mnx-hub__project" href="/mnx/feature-support">
            <span className="mnx-hub__project-kicker">Compare</span>
            <span className="mnx-hub__project-title">Feature support</span>
            <span className="mnx-hub__project-hint">
              Explore the notation taxonomy across MNX, MusicXML, Viritura engraving, and MXL import.
            </span>
            <span className="mnx-hub__project-action">Explore the coverage matrix →</span>
          </a>
        </div>
      </section>

      <MnxGuide />

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
        <a className="btn btn-primary" href={marketplaceUrl}>
          View in the Marketplace
        </a>
      </section>

      <section className="mnx-hub__editor-cta" aria-labelledby="mnx-editor-title">
        <Text as="p" variant="eyebrow" tone="muted">
          Work with MNX in Viritura
        </Text>
        <Text as="h2" id="mnx-editor-title" variant="title">
          Open the full notation editor.
        </Text>
        <Text as="p" variant="body" tone="muted">
          Create a score, open an example, or import MusicXML. Viritura keeps MNX at the center of the complete writing
          workspace.
        </Text>
        <a className="btn btn-primary" href={appUrl}>
          Open the Viritura editor
        </a>
      </section>
    </div>
  );
}
