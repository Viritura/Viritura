import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type { SiteLinks } from "./siteLinks";
import { VirituraLogo } from "./siteShared";

const workflowOutcomes = [
  {
    context: "Across revisions",
    title: "Know exactly what changed.",
    desc: "Git-backed history and visual score comparison keep every revision readable, recoverable, and in musical context.",
  },
  {
    context: "Across collaborators",
    title: "Discuss the music inside the music.",
    desc: "Live rooms, shared presence, and selections keep feedback attached to the passage instead of scattered across messages.",
  },
  {
    context: "Across deliverables",
    title: "Keep every view in agreement.",
    desc: "Full score, condensed score, and part layouts stay connected to one musical source through rehearsal and export.",
  },
];

const scorePartsSteps = [
  "Write directly into the full score, condensed score, or an individual part.",
  "See every edit resolve back to the same musical source.",
  "Let condensing and staff visibility adapt independently by system.",
  "Prepare and export every layout without reconciling duplicate files.",
];

const inputHighlights = [
  "Radial commands keep the next musical choice near the insertion point.",
  "Filter-first search gets you to the exact marking without browsing.",
  "Mode-aware shortcuts reduce hand travel across repeated edits.",
];

interface SiteNavProps {
  links: SiteLinks;
}

const mnxViewerUrl = "https://marketplace.visualstudio.com/items?itemName=Viritura.mnx-viewer";

export function SiteNav({ links }: SiteNavProps) {
  const [mnxMenuOpen, setMnxMenuOpen] = useState(false);
  const mnxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!mnxMenuRef.current?.contains(event.target as Node)) setMnxMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  const closeWhenFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) setMnxMenuOpen(false);
  };
  const closeOnEscape = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    flushSync(() => setMnxMenuOpen(false));
    mnxMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  };

  return (
    <nav className="nav">
      <a href="/" className="nav-logo" aria-label="Viritura home">
        <VirituraLogo />
      </a>
      <div className="nav-links" aria-label="Site navigation">
        <div
          ref={mnxMenuRef}
          className="nav-menu"
          onMouseEnter={() => setMnxMenuOpen(true)}
          onMouseLeave={() => setMnxMenuOpen(false)}
          onFocus={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setMnxMenuOpen(true);
          }}
          onBlur={closeWhenFocusLeaves}
          onKeyDown={closeOnEscape}
        >
          <span className="nav-menu-trigger">
            <a href="/mnx" onClick={() => setMnxMenuOpen(false)}>
              MNX
            </a>
            <button
              type="button"
              aria-label="Show MNX links"
              aria-expanded={mnxMenuOpen}
              aria-controls="mnx-nav-menu"
              onClick={() => setMnxMenuOpen((open) => !open)}
            >
              <span className="nav-menu-chevron" aria-hidden="true" />
            </button>
          </span>
          <div id="mnx-nav-menu" className="nav-submenu" hidden={!mnxMenuOpen}>
            <a href="/mnx/playground">Playground</a>
            <a href="/mnx/examples">Example library</a>
            <a href="/mnx/feature-support">Feature support</a>
            <a href="/mnx/mxl-converter">MusicXML converter</a>
            <a href={mnxViewerUrl} target="_blank" rel="noopener noreferrer">
              VS Code extension
            </a>
          </div>
        </div>
        <a href={links.docs}>Docs</a>
        <a href={links.app} className="btn btn-primary btn-nav">
          Open editor
        </a>
      </div>
    </nav>
  );
}

export function CollaborationValueStrip() {
  return (
    <section className="value-strip" aria-label="Viritura workflow">
      <span>Draft</span>
      <i />
      <span>Refine</span>
      <i />
      <span>Review</span>
      <i />
      <span>Prepare</span>
      <i />
      <span>Publish</span>
    </section>
  );
}

export function WorkflowSection() {
  return (
    <section className="workflow" id="for-your-work">
      <div className="section-heading section-heading-wide">
        <h2>Keep the work around the score connected.</h2>
        <p>
          Revisions, feedback, and parts often split into separate files and conversations. Viritura keeps them anchored
          to the same music.
        </p>
      </div>
      <div className="audience-outcomes">
        {workflowOutcomes.map((outcome) => (
          <article key={outcome.context} className="audience-outcome">
            <span>{outcome.context}</span>
            <h3>{outcome.title}</h3>
            <p>{outcome.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function InputSection({ links }: { links: SiteLinks }) {
  return (
    <section className="input-section" id="input">
      <div className="input-visual">
        <div className="input-preview">
          <div className="preview-toolbar">
            <span className="preview-dot" />
            <span className="preview-title">Fast note entry</span>
            <span className="preview-pill">Write</span>
          </div>
          <img
            className="input-image"
            src="/fast-workflow-preview.png"
            alt="A radial command wheel over a score, with clef and instrument options close to the selected music."
            width={792}
            height={527}
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
      <div className="input-copy">
        <h2>Stay in the passage.</h2>
        <p>
          Notation is hundreds of small decisions made in sequence. Viritura keeps common commands near the selection,
          lets you filter directly to the exact marking, and gives repeated work a keyboard rhythm.
        </p>
        <div className="input-highlights" aria-label="Fast input workflow highlights">
          {inputHighlights.map((highlight) => (
            <div key={highlight} className="input-highlight">
              <span className="status-dot" />
              <span>{highlight}</span>
            </div>
          ))}
        </div>
        <div className="mcp-note">
          <strong>Connect your tools to the score.</strong>
          <span>
            Connect an MCP-compatible client to inspect music, analyze harmony, and propose changes. Every proposal
            returns for visual review, never a silent direct write.
          </span>
        </div>
        <a href={links.app} className="btn btn-primary">
          Try the writing flow
        </a>
      </div>
    </section>
  );
}

export function PartsSection({ links }: { links: SiteLinks }) {
  return (
    <section className="parts-section" id="parts">
      <div className="parts-copy">
        <p className="parts-claim">An industry first in music notation</p>
        <h2>Edit any view. Keep one score.</h2>
        <p>
          Viritura&rsquo;s bidirectional condensing lets you write directly into the condensed conductor score or an
          individual part. Every edit changes the same underlying music, so neither view becomes a disposable output or
          a disconnected copy.
        </p>
        <a href={links.app} className="btn btn-primary">
          Try bidirectional condensing
        </a>
      </div>
      <div className="parts-visual">
        <div className="condensing-preview">
          <div className="preview-toolbar">
            <span className="preview-dot" />
            <span className="preview-title">Condensing workflow</span>
            <span className="preview-pill">Score & parts</span>
          </div>
          <img
            className="condensing-image"
            src="/condensing-preview.png"
            alt="A condensed horn staff above expanded Horn 1 and Horn 2 parts in the score editor."
            width={982}
            height={473}
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="steps-panel parts-steps" aria-label="Score and parts workflow">
          {scorePartsSteps.map((step, index) => (
            <div key={step} className="step-row">
              <span className="step-number">{index + 1}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CollaborationSection() {
  return (
    <section className="collaboration" id="review">
      <div className="collaboration-visual">
        <div className="preview-toolbar">
          <span className="preview-dot" />
          <span className="preview-title">Revision review</span>
          <span className="preview-pill">Version 12</span>
        </div>
        <img
          src="/diff-viewer-preview.png"
          alt="Two versions of a score compared visually with notation changes highlighted."
          width={602}
          height={282}
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="collaboration-copy">
        <h2>Review belongs in the score.</h2>
        <p className="collaboration-lede">
          Stop translating musical changes through screenshots, filenames, and message threads. Viritura keeps review
          attached to the score.
        </p>
        <div className="collaboration-points">
          <div>
            <h3>See the change</h3>
            <p>Visual score diff and measure-level review make revisions legible in context.</p>
          </div>
          <div>
            <h3>Share the moment</h3>
            <p>Peer-to-peer live rooms carry shared editing and presence without separating feedback from the score.</p>
          </div>
          <div>
            <h3>Keep the history</h3>
            <p>Git-backed projects preserve drafts so creative decisions stay comparable and recoverable.</p>
          </div>
        </div>
        <p className="collaboration-note">
          Live-room hosting currently requires a Chromium browser. Cloud-backed project sync remains in development.
        </p>
      </div>
    </section>
  );
}

export function OpenApproachSection() {
  return (
    <section className="open-approach" id="open-format">
      <div className="open-approach-heading">
        <h2>Your scores should outlive the software that made them.</h2>
        <p>Open format. Git-backed. No dead-end files.</p>
      </div>
      <div className="open-approach-copy">
        <p>
          From SCORE&rsquo;s decline to Finale&rsquo;s discontinuation, proprietary notation formats have repeatedly
          stranded musicians&rsquo; work.
        </p>
        <p>
          Viritura stores scores as{" "}
          <a href="https://w3c-cg.github.io/mnx/docs/" target="_blank" rel="noopener noreferrer">
            MNX, an open music notation format
          </a>{" "}
          from the W3C Music Notation Community Group. Projects are git-backed, so access to your work does not depend
          on Viritura being the last app standing.
        </p>
        <p>
          To support MNX adoption, Viritura provides interactive examples and browser-based tools covering the standard,
          Viritura extensions, and common engraving behavior. <a href="/mnx">Explore Viritura&rsquo;s MNX projects</a>.
        </p>
      </div>
    </section>
  );
}

export function FinalCtaSection({ links }: { links: SiteLinks }) {
  return (
    <section className="final-cta">
      <h2>Your next draft can stay connected.</h2>
      <p>
        Open the editor in your browser and start blank, use a working sample, or import MusicXML. No download required.
      </p>
      <div className="hero-buttons final-buttons">
        <a href={links.app} className="btn btn-primary">
          Open the web editor
        </a>
      </div>
    </section>
  );
}

export function SiteFooter({ links }: { links: SiteLinks }) {
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} Viritura. Built on open standards.</span>
      <div className="footer-links">
        <a href={links.github} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <a href={links.docs}>Docs</a>
        <a href={links.app}>Editor</a>
      </div>
    </footer>
  );
}
