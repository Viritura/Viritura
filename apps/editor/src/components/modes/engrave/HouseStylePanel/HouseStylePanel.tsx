import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Collapsible, PanelSearchHeader } from "@viritura/ui";

import { TextStylesPanel } from "./TextStylesPanel";
import { TimeSignatureAppearance } from "./TimeSignatureAppearance";
import { PageTurnsPanel } from "./PageTurnsPanel";
import { ChordSymbolsPanel } from "./ChordSymbolsPanel";
import { InstrumentChangesPanel } from "./InstrumentChangesPanel";
import { BarNumbersPanel } from "./BarNumbersPanel";
import type { ProfileScope } from "../../../../engraveStyle";
import styles from "./HouseStylePanel.module.css";

type HouseStyleCategory =
  "page" | "time-signatures" | "chord-symbols" | "text-styles" | "page-turns" | "instrument-changes" | "bar-numbers";

interface CategoryContext {
  pageScope: ProfileScope;
  pageSection: ReactNode;
}

interface CategoryDefinition {
  id: HouseStyleCategory;
  title: string;
  keywords: string;
  render: (context: CategoryContext) => ReactNode;
}

const CATEGORIES: readonly CategoryDefinition[] = [
  {
    id: "page",
    title: "Page",
    keywords: "page size paper orientation portrait landscape staff size rastral margins profile score part",
    render: ({ pageSection }) => pageSection,
  },
  {
    id: "bar-numbers",
    title: "Bar Numbers",
    keywords: "bar measure numbers every system layout font size bold italic box circle above below grand staff",
    render: () => <BarNumbersPanel scope="document" />,
  },
  {
    id: "instrument-changes",
    title: "Instrument Changes",
    keywords: "instrument transposition tuning change label advance reminder show hide visibility",
    render: () => <InstrumentChangesPanel />,
  },
  {
    id: "chord-symbols",
    title: "Chord Symbols",
    keywords:
      "chord harmony jazz root uppercase lowercase major minor diminished half diminished augmented superscript extension",
    render: () => <ChordSymbolsPanel />,
  },
  {
    id: "time-signatures",
    title: "Time Signatures",
    keywords: "time signature meter numerator denominator film score distribution staff position scale large",
    render: () => <TimeSignatureAppearance />,
  },
  {
    id: "page-turns",
    title: "Page Turns",
    keywords:
      "page turn pagination physical rest seconds comfortable volti subito vs density fill partial blank title recto verso tempo weight sparse time marking",
    render: ({ pageScope }) => <PageTurnsPanel scope={pageScope} />,
  },
  {
    id: "text-styles",
    title: "Text Styles",
    keywords:
      "text font typography title subtitle composer lyricist arranger label page tempo pedal copyright size bold italic color align",
    render: () => <TextStylesPanel />,
  },
];

const DEFAULT_OPEN: Record<HouseStyleCategory, boolean> = {
  page: true,
  "time-signatures": false,
  "chord-symbols": false,
  "page-turns": false,
  "text-styles": false,
  "instrument-changes": false,
  "bar-numbers": false,
};

interface HouseStylePanelProps {
  /** Profile whose page setup and page turns are edited. */
  pageScope: ProfileScope;
  /** Page fields for `pageScope`, rendered in the Page section. */
  pageSection: ReactNode;
}

/** Searchable score-wide engraving controls with the live canvas beside them. */
export function HouseStylePanel({ pageScope, pageSection }: HouseStylePanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [openMap, setOpenMap] = useState(DEFAULT_OPEN);
  const terms = useMemo(() => searchQuery.toLowerCase().split(/\s+/).filter(Boolean), [searchQuery]);
  const visibleCategories = useMemo(
    () =>
      CATEGORIES.filter((category) => {
        if (terms.length === 0) return true;
        const haystack = `${category.title} ${category.keywords}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      }),
    [terms],
  );
  const searching = terms.length > 0;
  const anyOpen = visibleCategories.some((category) => searching || openMap[category.id]);

  const handleToggleAll = useCallback(() => {
    const nextOpen = !anyOpen;
    setOpenMap((current) => ({
      ...current,
      ...Object.fromEntries(visibleCategories.map((category) => [category.id, nextOpen])),
    }));
  }, [anyOpen, visibleCategories]);

  return (
    <aside className={styles.root} data-testid="house-style-panel">
      <PanelSearchHeader
        value={searchQuery}
        onValueChange={setSearchQuery}
        placeholder="Search house style..."
        searchLabel="Search house style"
        anyOpen={anyOpen}
        onToggleAll={handleToggleAll}
        toggleLabel={anyOpen ? "Collapse all House Style sections" : "Expand all House Style sections"}
        toggleDisabled={searching || visibleCategories.length === 0}
      />
      <div className={`viritura-scroll ${styles.body}`}>
        {visibleCategories.map((category) => (
          <Collapsible
            key={category.id}
            title={category.title}
            open={searching || openMap[category.id]}
            onOpenChange={(open) => setOpenMap((current) => ({ ...current, [category.id]: open }))}
          >
            <div className={styles.categoryBody}>{category.render({ pageScope, pageSection })}</div>
          </Collapsible>
        ))}
        {visibleCategories.length === 0 && (
          <p className={styles.noResults}>No House Style controls match “{searchQuery}”.</p>
        )}
      </div>
    </aside>
  );
}
