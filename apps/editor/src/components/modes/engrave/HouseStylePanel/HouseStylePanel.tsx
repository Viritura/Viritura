import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown, X } from "lucide-react";
import { Collapsible, FormInput, IconButton, Tooltip } from "@viritura/ui";

import { TextStylesPanel } from "./TextStylesPanel";
import { TimeSignatureAppearance } from "./TimeSignatureAppearance";
import { PageTurnsPanel } from "./PageTurnsPanel";
import styles from "./HouseStylePanel.module.css";

type HouseStyleCategory = "time-signatures" | "text-styles" | "page-turns";

interface CategoryDefinition {
  id: HouseStyleCategory;
  title: string;
  keywords: string;
  render: () => ReactNode;
}

const CATEGORIES: readonly CategoryDefinition[] = [
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
    render: () => <PageTurnsPanel />,
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
  "time-signatures": true,
  "page-turns": false,
  "text-styles": false,
};

/** Searchable score-wide engraving controls with the live canvas beside them. */
export function HouseStylePanel() {
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
      <div className={styles.searchRow}>
        <div className={styles.searchInputWrap}>
          <FormInput
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            placeholder="Search house style..."
            aria-label="Search house style"
          />
          {searchQuery && (
            <IconButton size="sm" onClick={() => setSearchQuery("")} tooltip="Clear search">
              <X size={12} />
            </IconButton>
          )}
        </div>
        <Tooltip content={anyOpen ? "Collapse all" : "Expand all"}>
          <IconButton
            size="md"
            disabled={searching || visibleCategories.length === 0}
            onClick={handleToggleAll}
            tooltip={anyOpen ? "Collapse all House Style sections" : "Expand all House Style sections"}
          >
            {anyOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
          </IconButton>
        </Tooltip>
      </div>
      <div className={`viritura-scroll ${styles.body}`}>
        {visibleCategories.map((category) => (
          <Collapsible
            key={category.id}
            title={category.title}
            open={searching || openMap[category.id]}
            onOpenChange={(open) => setOpenMap((current) => ({ ...current, [category.id]: open }))}
          >
            <div className={styles.categoryBody}>{category.render()}</div>
          </Collapsible>
        ))}
        {visibleCategories.length === 0 && (
          <p className={styles.noResults}>No House Style controls match “{searchQuery}”.</p>
        )}
      </div>
    </aside>
  );
}
