import type { CSSProperties } from "react";
import styles from "./FolioFaviconExplorations.module.css";

interface FaviconDirection {
  readonly id: string;
  readonly name: string;
  readonly thesis: string;
  readonly className?: string;
  readonly selected?: boolean;
}

const DIRECTIONS: readonly FaviconDirection[] = [
  {
    id: "rules",
    name: "Printer's Rules",
    thesis: "The selected Folio V held between the same hairlines used in the wordmark specimen.",
    className: styles.rules,
  },
  {
    id: "field",
    name: "Viridian Field",
    thesis: "The simplest production answer: a warm-paper V reversed from a full viridian tile.",
    className: styles.field,
  },
  {
    id: "seal",
    name: "Edition Seal",
    thesis: "A circular publisher's seal gives the initial authority without introducing a separate symbol.",
    className: styles.seal,
  },
  {
    id: "crop",
    name: "Cropped Versal",
    thesis: "An oversized V runs beyond the tile like a monumental opening capital on a modern edition.",
    className: styles.crop,
  },
  {
    id: "cropKeyline",
    name: "Cropped Versal — Keyline",
    thesis: "The same monumental V gains a fine warm-paper edge that contains the crop without softening it.",
    className: styles.cropKeyline,
    selected: true,
  },
  {
    id: "bookplate",
    name: "Bookplate",
    thesis: "A fine double frame references title-page borders and ownership plates in a compact square.",
    className: styles.bookplate,
  },
  {
    id: "margin",
    name: "Margin Rule",
    thesis: "The V sits against one editorial margin line, asymmetrical and recognizably part of the Folio system.",
    className: styles.margin,
  },
  {
    id: "colophon",
    name: "Colophon",
    thesis: "A period turns the initial into a concise publishing signature: Viritura, stated rather than illustrated.",
    className: styles.colophon,
  },
  {
    id: "diamond",
    name: "Printer's Diamond",
    thesis: "The Folio V is placed in a rotated typographic ornament, the most emblematic route in the set.",
    className: styles.diamond,
  },
];

interface FaviconProps {
  readonly direction: FaviconDirection;
  readonly size: 16 | 32 | 64 | 128;
}

function FolioFavicon({ direction, size }: FaviconProps) {
  const style: CSSProperties & { "--favicon-size": string } = {
    "--favicon-size": `${size}px`,
  };
  return (
    <span
      className={`${styles.favicon} ${direction.className ?? ""}`}
      style={style}
      aria-label={`${direction.name} favicon at ${size} pixels`}
    >
      <span className={styles.letter}>V</span>
    </span>
  );
}

function BrowserTab({ direction }: { readonly direction: FaviconDirection }) {
  return (
    <div className={styles.browserTab}>
      <FolioFavicon direction={direction} size={16} />
      <span>Viritura</span>
      <span className={styles.tabClose} aria-hidden="true">
        ×
      </span>
    </div>
  );
}

function DirectionRow({ direction, index }: { readonly direction: FaviconDirection; readonly index: number }) {
  return (
    <article className={`${styles.direction} ${direction.selected ? styles.selected : ""}`} id={direction.id}>
      <div className={styles.directionIdentity}>
        <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h2>{direction.name}</h2>
          {direction.selected && <span className={styles.selectionBadge}>Selected production mark</span>}
          <p>{direction.thesis}</p>
        </div>
      </div>
      <div className={styles.heroIcon}>
        <FolioFavicon direction={direction} size={128} />
      </div>
      <div className={styles.proofs}>
        <div className={styles.sizeRun}>
          <FolioFavicon direction={direction} size={16} />
          <FolioFavicon direction={direction} size={32} />
          <FolioFavicon direction={direction} size={64} />
        </div>
        <BrowserTab direction={direction} />
      </div>
    </article>
  );
}

export function FolioFaviconExplorations() {
  return (
    <main className={styles.studio}>
      <header className={styles.introduction}>
        <div>
          <p className={styles.selectedDirection}>Selected identity · Folio Display + Contained Versal Keyline</p>
          <h1>The V, reduced to a publishing mark.</h1>
          <p className={styles.lede}>
            {DIRECTIONS.length} favicon routes, all cut from the same Libertinus initial. The selected keyline mark is
            retained beside its alternates as the production reference.
          </p>
        </div>
        <div className={styles.wordmark} aria-label="Viritura">
          Viritura
        </div>
      </header>

      <nav className={styles.directionNav} aria-label="Favicon directions">
        {DIRECTIONS.map((direction) => (
          <a href={`#${direction.id}`} key={direction.id}>
            {direction.name}
          </a>
        ))}
      </nav>

      <section className={styles.directions} aria-label="Favicon comparison">
        {DIRECTIONS.map((direction, index) => (
          <DirectionRow direction={direction} index={index} key={direction.id} />
        ))}
      </section>
    </main>
  );
}
