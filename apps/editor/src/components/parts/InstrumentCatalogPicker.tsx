import { useMemo, useRef, useState, useEffect, type CSSProperties } from "react";
import { AlertTriangle, Check, CircleSlash, Plus, Search, X } from "lucide-react";
import { Collapsible, FormInput, IconButton, ListRow } from "@viritura/ui";
import {
  INSTRUMENT_CATALOG,
  type CatalogInstrument,
  type InstrumentFamily,
  getFamiliesInOrder,
  getInstrumentsByFamily,
} from "../../score/InstrumentCatalog";
import { FAMILY_COLORS, searchInputStyle } from "./styles";

const PICKER_ROOT_STYLE: CSSProperties = { display: "flex", flexDirection: "column", minHeight: 0 };
const PICKER_TITLE_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "4px 6px 2px",
};
const PICKER_SEARCH_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 4, padding: "4px 6px" };
const SEARCH_ICON_STYLE: CSSProperties = { color: "var(--text-muted)", flexShrink: 0 };
const NO_RESULTS_STYLE: CSSProperties = {
  padding: "6px 8px",
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  fontStyle: "italic",
};
const FAMILY_COUNT_STYLE: CSSProperties = { fontSize: "var(--type-eyebrow-size)", color: "var(--text-muted)" };
const COMPATIBILITY_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: "var(--type-eyebrow-size)",
};
function listScrollStyle(maxHeight: number): CSSProperties {
  return { flex: 1, overflowY: "auto", maxHeight };
}
function familyDotStyle(family: InstrumentFamily): CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: FAMILY_COLORS[family],
    flexShrink: 0,
  };
}

export interface InstrumentCatalogPickerProps {
  onSelect: (inst: CatalogInstrument) => void;
  /** Placeholder text for the search input. */
  searchPlaceholder?: string;
  /** Optional title shown above the search row. */
  title?: string;
  /** Optional close handler — when provided, an X button appears next to the search input. */
  onClose?: () => void;
  /** Auto-focus the search input on mount. Default false. */
  autoFocus?: boolean;
  /** Max height of the scrollable result list. Default 240. */
  maxHeight?: number;
  /** Initial expanded families. Defaults to none. */
  initiallyExpanded?: InstrumentFamily[];
  /** Show instrument totals beside family headings. Defaults to true. */
  showFamilyCounts?: boolean;
  /** Optional compatibility analysis used by Change Instrument. */
  compatibility?: (inst: CatalogInstrument) => InstrumentCompatibility;
  /** Invoked for blocked choices so hosts can offer a safe Add Instead path. */
  onBlockedSelect?: (inst: CatalogInstrument, analysis: InstrumentCompatibility) => void;
}

export interface InstrumentCompatibility {
  status: "compatible" | "warning" | "blocked";
  message?: string;
}

/**
 * Reusable instrument catalog picker.
 *
 * Two modes, both driven by the same component:
 *   1. Search active → flat filtered results
 *   2. Search empty  → family-grouped tree (expand/collapse per family)
 *
 * Used by the Roster mode add-instrument flow and by the doubling
 * picker in Layouts mode.
 */
export function InstrumentCatalogPicker({
  onSelect,
  searchPlaceholder = "Search instruments…",
  title,
  onClose,
  autoFocus = false,
  maxHeight = 240,
  initiallyExpanded,
  showFamilyCounts = true,
  compatibility,
  onBlockedSelect,
}: InstrumentCatalogPickerProps) {
  const [search, setSearch] = useState("");
  const defaultExpanded = useMemo(() => new Set(initiallyExpanded ?? []), [initiallyExpanded]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      const id = window.setTimeout(() => searchRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [autoFocus]);

  const filtered = useMemo((): CatalogInstrument[] | null => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return INSTRUMENT_CATALOG.filter(
      (i) =>
        i.name.toLowerCase().includes(q) || i.shortName.toLowerCase().includes(q) || i.family.toLowerCase().includes(q),
    );
  }, [search]);

  const instrumentRow = (instrument: CatalogInstrument, compact = false) => {
    const analysis = compatibility?.(instrument);
    const blocked = analysis?.status === "blocked";
    return (
      <ListRow
        key={instrument.id}
        onClick={() => (blocked ? onBlockedSelect?.(instrument, analysis) : onSelect(instrument))}
        tooltip={analysis?.message ?? `Add ${instrument.name}`}
        density={compact ? "compact" : undefined}
        indent={compact}
        aria-disabled={blocked || undefined}
        leading={!compact ? <span style={familyDotStyle(instrument.family)} /> : undefined}
        trailing={analysis ? <CompatibilityLabel analysis={analysis} /> : <Plus size={10} />}
      >
        {instrument.name}
      </ListRow>
    );
  };

  return (
    <div style={PICKER_ROOT_STYLE}>
      {title && <div style={PICKER_TITLE_STYLE}>{title}</div>}
      <div style={PICKER_SEARCH_ROW_STYLE}>
        <Search size={12} style={SEARCH_ICON_STYLE} />
        <FormInput
          ref={searchRef}
          type="text"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={searchInputStyle}
        />
        {search && (
          <IconButton onClick={() => setSearch("")} tooltip="Clear search" size="sm">
            <X size={10} />
          </IconButton>
        )}
        {onClose && (
          <IconButton onClick={onClose} tooltip="Close" size="sm">
            <X size={12} />
          </IconButton>
        )}
      </div>
      <div style={listScrollStyle(maxHeight)}>
        {filtered ? (
          filtered.length === 0 ? (
            <div style={NO_RESULTS_STYLE}>No results</div>
          ) : (
            filtered.map((inst) => instrumentRow(inst))
          )
        ) : (
          getFamiliesInOrder().map(({ family, label }) => {
            const instruments = getInstrumentsByFamily(family);
            return (
              <Collapsible
                key={family}
                title={label}
                defaultOpen={defaultExpanded.has(family)}
                icon={<span style={familyDotStyle(family)} />}
                actions={showFamilyCounts ? <span style={FAMILY_COUNT_STYLE}>{instruments.length}</span> : undefined}
              >
                {instruments.map((inst) => instrumentRow(inst, true))}
              </Collapsible>
            );
          })
        )}
      </div>
    </div>
  );
}

function CompatibilityLabel({ analysis }: { analysis: InstrumentCompatibility }) {
  const content =
    analysis.status === "compatible" ? (
      <>
        <Check size={10} /> Compatible
      </>
    ) : analysis.status === "warning" ? (
      <>
        <AlertTriangle size={10} /> Review
      </>
    ) : (
      <>
        <CircleSlash size={10} /> Add instead
      </>
    );
  return <span style={COMPATIBILITY_STYLE}>{content}</span>;
}
