import styles from "./LogoExplorations.module.css";
import variantStyles from "./LogoExplorationVariants.module.css";

interface Proposal {
  readonly id: string;
  readonly name: string;
  readonly word?: string;
  readonly mark?: string;
  readonly style: string;
  readonly thesis: string;
  readonly bestFor: string;
  readonly risk: string;
  readonly className?: string;
}

const PROPOSALS: readonly Proposal[] = [
  {
    id: "legato",
    name: "Legato",
    style: "Editorial / expressive",
    thesis:
      "A high-contrast publishing voice with an elongated terminal that makes the name feel written, not typeset.",
    bestFor: "A composer-first identity with cultural weight and elegant publishing applications.",
    risk: "The fine strokes need a simplified small-size cut.",
    className: styles.legato,
  },
  {
    id: "imprint",
    name: "Makerplate",
    style: "Machined / modern",
    thesis:
      "A precision-cut wordmark sits inside an anodized viridian plate: maker provenance without vintage ornament.",
    bestFor: "A modern master-brand system that can extend to desktop chrome, hardware, cases, and physical editions.",
    risk: "The material plate should remain an application of the flat wordmark, not replace it.",
    className: styles.imprint,
  },
  {
    id: "grotesk",
    name: "Viridian Grotesk",
    style: "Flat / Swiss",
    thesis:
      "An uncompromising grotesk cut lets the unusual name do the work, with a compact V framed by pure proportion.",
    bestFor: "A durable master brand that can sit quietly across editor, website, documentation, and publishing.",
    risk: "The system depends on exceptional custom kerning rather than a conspicuous signature gesture.",
    className: variantStyles.grotesk,
  },
  {
    id: "scoreline",
    name: "Scoreline",
    style: "Linear / notation-led",
    thesis:
      "A single viridian rule passes through the letters like a staff line without turning into a literal music icon.",
    bestFor: "A restrained musical cue that remains credible in professional software and printed collateral.",
    risk: "The line needs optical adjustment at every production size.",
    className: variantStyles.scoreline,
  },
  {
    id: "ligature",
    name: "Ligature",
    style: "Custom / connected",
    thesis: "The central rit becomes one continuous gesture, making collaboration visible inside the lettering itself.",
    bestFor: "A proprietary-feeling wordmark with enough personality for both product and cultural partnerships.",
    risk: "The custom join must remain readable outside large display use.",
    className: variantStyles.ligature,
  },
  {
    id: "folio",
    name: "Folio — Display",
    style: "Publishing / display",
    thesis:
      "The original high-character cut keeps its classical title-page presence for large, deliberate brand moments.",
    bestFor: "Launch screens, exported editions, title pages, marketing mastheads, and institutional partnerships.",
    risk: "Its fine detail is intentionally unsuitable for compact application chrome.",
    className: variantStyles.folio,
  },
  {
    id: "folioText",
    name: "Folio — Text",
    style: "Optical / compact",
    thesis:
      "A heavier mixed-case optical cut opens the spacing and reinforces thin joins so Folio survives application sizes.",
    bestFor: "Editor chrome, compact headers, navigation, documentation, and small print applications.",
    risk: "Its sturdier construction gives up some of Display's elegance.",
    className: variantStyles.folioText,
  },
  {
    id: "folioHybrid",
    name: "Folio — Editorial Hybrid",
    style: "Classical / contemporary",
    thesis:
      "Folio's authoritative initial meets Editorial's sturdier lowercase rhythm, preserving distinction with better optical resilience.",
    bestFor: "A single primary wordmark that bridges score culture, product UI, and contemporary publishing.",
    risk: "The two voices must be custom-drawn together to avoid looking assembled from separate fonts.",
    className: variantStyles.folioHybrid,
  },
  {
    id: "editorial",
    name: "Editorial",
    style: "Contemporary serif",
    thesis:
      "A modern serif balances a sturdy V with quick, compact lowercase forms for a distinctly publishing-minded voice.",
    bestFor: "A serious composer brand that bridges long-form reading, score publishing, and software.",
    risk: "It needs a sharper custom detail to fully escape the editorial category.",
    className: variantStyles.editorial,
  },
];

function LegatoWordmark({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className={`${styles.wordmark} ${styles.legatoWordmark} ${compact ? styles.compact : ""}`}>
      Viri<span>tura</span>
    </span>
  );
}

function ImprintWordmark({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className={`${styles.wordmark} ${styles.imprintWordmark} ${compact ? styles.compact : ""}`}>Viritura</span>
  );
}

function FolioHybridWordmark({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span
      aria-label="Viritura"
      className={`${styles.wordmark} ${variantStyles.folioHybridWordmark} ${
        compact ? `${styles.compact} ${variantStyles.compact}` : ""
      }`}
    >
      <span className={variantStyles.folioHybridInitial} aria-hidden="true">
        V
      </span>
      <span aria-hidden="true">iritura</span>
    </span>
  );
}

function ProposalWordmark({ proposal, compact = false }: { readonly proposal: Proposal; readonly compact?: boolean }) {
  switch (proposal.id) {
    case "legato":
      return <LegatoWordmark compact={compact} />;
    case "imprint":
      return <ImprintWordmark compact={compact} />;
    case "folioHybrid":
      return <FolioHybridWordmark compact={compact} />;
    default:
      return (
        <span
          className={`${styles.wordmark} ${
            variantStyles[`${proposal.id}Wordmark`] ?? styles[`${proposal.id}Wordmark`] ?? styles.genericWordmark
          } ${compact ? `${styles.compact} ${variantStyles.compact}` : ""}`}
          data-word={proposal.word ?? "Viritura"}
        >
          {proposal.word ?? "Viritura"}
        </span>
      );
  }
}

function ProposalMark({ proposal, small = false }: { readonly proposal: Proposal; readonly small?: boolean }) {
  return (
    <span
      className={`${styles.mark} ${
        variantStyles[`${proposal.id}Mark`] ?? styles[`${proposal.id}Mark`] ?? styles.genericMark
      } ${small ? styles.smallMark : ""}`}
      aria-hidden="true"
    >
      {proposal.mark ?? "V"}
    </span>
  );
}

function ApplicationStrip({ proposal }: { readonly proposal: Proposal }) {
  return (
    <div className={styles.applicationStrip} aria-label={`${proposal.name} app chrome preview`}>
      <div className={styles.appIdentity}>
        <ProposalMark proposal={proposal} small />
        <ProposalWordmark proposal={proposal} compact />
      </div>
      <span className={styles.documentName}>String Quartet No. 2</span>
      <div className={styles.windowControls} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function ProposalSection({ proposal }: { readonly proposal: Proposal }) {
  return (
    <article className={`${styles.proposal} ${proposal.className ?? ""}`} id={proposal.id}>
      <div className={`${styles.stage} ${variantStyles[`${proposal.id}Stage`] ?? ""}`}>
        <div className={`${styles.primaryLockup} ${variantStyles[`${proposal.id}Lockup`] ?? ""}`}>
          <ProposalMark proposal={proposal} />
          <ProposalWordmark proposal={proposal} />
        </div>
        <div className={styles.scaleProof} aria-label={`${proposal.name} derived mark at three sizes`}>
          <ProposalMark proposal={proposal} />
          <ProposalMark proposal={proposal} small />
          <span className={styles.faviconFrame}>
            <ProposalMark proposal={proposal} small />
          </span>
        </div>
      </div>

      <div className={styles.proposalNotes}>
        <div className={styles.proposalTitle}>
          <h2>{proposal.name}</h2>
          <span>{proposal.style}</span>
        </div>
        <p className={styles.thesis}>{proposal.thesis}</p>
        <dl>
          <div>
            <dt>Best fit</dt>
            <dd>{proposal.bestFor}</dd>
          </div>
          <div>
            <dt>Watch-out</dt>
            <dd>{proposal.risk}</dd>
          </div>
        </dl>
      </div>

      <ApplicationStrip proposal={proposal} />
    </article>
  );
}

export function LogoExplorations() {
  return (
    <main className={styles.studio}>
      <header className={styles.introduction}>
        <div className={styles.introCopy}>
          <h1>Ways Viritura could sound before the first note.</h1>
          <p>
            Typography leads every direction. Each mark is cut directly from its wordmark, so the identity stays
            authored, legible, and production-ready from a 16-pixel tab to a launch screen.
          </p>
        </div>
        <div className={styles.criteria}>
          <strong>Evaluation lens</strong>
          <span>Professional, not institutional</span>
          <span>Viridian in every direction</span>
          <span>Musical, not pictographic</span>
          <span>Distinct in monochrome</span>
          <span>Credible beside an engraved score</span>
        </div>
      </header>

      <nav className={styles.proposalNav} aria-label="Logo proposals">
        {PROPOSALS.map((proposal) => (
          <a href={`#${proposal.id}`} key={proposal.id}>
            {proposal.name}
          </a>
        ))}
      </nav>

      {PROPOSALS.map((proposal) => (
        <ProposalSection key={proposal.id} proposal={proposal} />
      ))}

      <footer className={styles.recommendation}>
        <div>
          <h2>Recommended shortlist</h2>
          <p>
            <strong>Folio Display</strong> is the most distinctive large-scale route. <strong>Folio Text</strong> proves
            the system at compact sizes. <strong>Folio Hybrid</strong> tests whether one cut can bridge both roles.
          </p>
        </div>
        <p>
          The remaining directions concentrate on classical publishing character, contemporary editorial resilience, and
          a small set of contrasting sans and crafted alternatives.
        </p>
      </footer>
    </main>
  );
}
