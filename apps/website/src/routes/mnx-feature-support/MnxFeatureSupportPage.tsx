import { SearchInput, Text } from "@viritura/ui";
import { coverageAudit } from "./coverageData";
import {
  STATUS_LABELS,
  partialReasonForSurface,
  statusForSurface,
  summarizeStatuses,
  type CoverageFilters,
  type CoverageRow,
  type CoverageSurface,
  type CoverageSummary,
  type SupportStatus,
} from "./coverageModel";
import { useCoverageExplorer } from "./useCoverageExplorer";
import "./featureSupport.css";

function StatusBadge({ status }: { readonly status: SupportStatus }) {
  return (
    <span className="feature-support__status" data-status={status} title={STATUS_LABELS[status]}>
      <span aria-hidden="true">{status === "S" ? "✓" : status === "P" ? "◐" : status === "N" ? "—" : "·"}</span>
      {STATUS_LABELS[status]}
    </span>
  );
}

function SupportPieChart({ title, summary }: { readonly title: string; readonly summary: CoverageSummary }) {
  const segments: readonly { status: SupportStatus; value: number }[] = [
    { status: "S", value: summary.supported },
    { status: "P", value: summary.partial },
    { status: "N", value: summary.unsupported },
    { status: "NA", value: summary.notApplicable },
    { status: "?", value: summary.unknown },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  const supportedPercent = total > 0 ? Math.round((summary.supported / total) * 100) : 0;
  const description = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => `${STATUS_LABELS[segment.status]} ${segment.value}`)
    .join(", ");

  return (
    <figure className="feature-support__pie">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${title} coverage: ${description}`}>
        <circle className="feature-support__pie-track" cx="50" cy="50" r="42" pathLength="100" />
        {segments.map((segment) => {
          if (segment.value === 0 || total === 0) return null;
          const percent = (segment.value / total) * 100;
          const visiblePercent = Math.max(percent - 0.45, 0);
          const circle = (
            <circle
              key={segment.status}
              className="feature-support__pie-segment"
              data-status={segment.status}
              cx="50"
              cy="50"
              r="42"
              pathLength="100"
              strokeDasharray={`${visiblePercent} ${100 - visiblePercent}`}
              strokeDashoffset={-offset}
            />
          );
          offset += percent;
          return circle;
        })}
      </svg>
      <figcaption>
        <strong>{supportedPercent}%</strong>
        <span>supported</span>
      </figcaption>
    </figure>
  );
}

function SummaryCard({
  title,
  summary,
  note,
}: {
  readonly title: string;
  readonly summary: CoverageSummary;
  readonly note: string;
}) {
  return (
    <article className="feature-support__summary-card">
      <p className="feature-support__summary-label">{title}</p>
      <div className="feature-support__summary-main">
        <div>
          <strong>{summary.supported}</strong>
          <span>supported concepts</span>
        </div>
        <SupportPieChart title={title} summary={summary} />
      </div>
      <dl>
        <div>
          <dt>Partial</dt>
          <dd>{summary.partial}</dd>
        </div>
        <div>
          <dt>Unsupported</dt>
          <dd>{summary.unsupported}</dd>
        </div>
        {summary.notApplicable > 0 && (
          <div>
            <dt>Derived</dt>
            <dd>{summary.notApplicable}</dd>
          </div>
        )}
        {summary.unknown > 0 && (
          <div>
            <dt>Unknown</dt>
            <dd>{summary.unknown}</dd>
          </div>
        )}
      </dl>
      <p>{note}</p>
    </article>
  );
}

function CoverageTable({
  rows,
  surface,
}: {
  readonly rows: readonly CoverageRow[];
  readonly surface: CoverageSurface;
}) {
  return (
    <div className="feature-support__table-wrap">
      <table className="feature-support__table">
        <thead>
          <tr>
            <th scope="col">Concept</th>
            <th scope="col">MNX format</th>
            <th scope="col">MusicXML format</th>
            <th scope="col">Viritura MNX</th>
            <th scope="col">
              <span title="Viritura MusicXML/MXL importer">Viritura MXL</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const partialReason = partialReasonForSurface(row, surface);
            return (
              <tr
                id={row.id}
                key={row.id}
                data-active-status={statusForSurface(row, surface)}
                onClick={(event) => {
                  if (event.target instanceof Element && event.target.closest("a")) return;
                  window.location.hash = row.id;
                }}
              >
                <th scope="row">
                  <span className="feature-support__taxonomy">{row.subgroup}</span>
                  <a href={`#${row.id}`}>{row.concept}</a>
                  <code>{row.id}</code>
                  {partialReason && (
                    <p className="feature-support__partial-reason">
                      <strong>
                        {STATUS_LABELS[statusForSurface(row, surface)]} · {partialReason.kind}
                      </strong>
                      <span>{partialReason.text}</span>
                    </p>
                  )}
                </th>
                <td data-label="MNX format">
                  <StatusBadge status={row.mnx} />
                </td>
                <td data-label="MusicXML format">
                  <StatusBadge status={row.musicXml} />
                </td>
                <td data-label="Viritura MNX">
                  <StatusBadge status={row.virituraMnx} />
                </td>
                <td data-label="Viritura MXL">
                  <StatusBadge status={row.virituraMxl} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CoverageGroup({
  group,
  rows,
  surface,
  open,
  onOpenChange,
}: {
  readonly group: string;
  readonly rows: readonly CoverageRow[];
  readonly surface: CoverageSurface;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const summary = summarizeStatuses(rows.map((row) => statusForSurface(row, surface)));
  const statusCounts: readonly { status: SupportStatus; count: number }[] = [
    { status: "S", count: summary.supported },
    { status: "P", count: summary.partial },
    { status: "N", count: summary.unsupported },
    { status: "NA", count: summary.notApplicable },
    { status: "?", count: summary.unknown },
  ];
  return (
    <details className="feature-support__group" open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          onOpenChange(!open);
        }}
      >
        <span className="feature-support__group-name">
          <strong>{group}</strong>
          <small>{rows.length} concepts</small>
        </span>
        <span className="feature-support__group-counts">
          {statusCounts
            .filter((item) => item.count > 0)
            .map((item) => (
              <span key={item.status} data-status={item.status} title={STATUS_LABELS[item.status]}>
                {item.status} {item.count}
              </span>
            ))}
        </span>
      </summary>
      {open && <CoverageTable rows={rows} surface={surface} />}
    </details>
  );
}

export function MnxFeatureSupportPage() {
  const { filters, rows, groupedRows, openGroups, updateFilter, setGroupOpen, resetFilters, expandAll, collapseAll } =
    useCoverageExplorer();

  return (
    <div className="feature-support">
      <header className="feature-support__hero">
        <div>
          <Text as="p" variant="eyebrow" tone="muted">
            Source-validated implementation audit
          </Text>
          <Text as="h1" variant="display">
            Music notation feature support
          </Text>
          <Text as="p" variant="body" tone="muted">
            Explore all 852 concepts in the W3C Music Notation Reference and compare what the formats can represent with
            what Viritura actually engraves and imports.
          </Text>
        </div>
        <aside>
          <span>Audit snapshot</span>
          <p>{coverageAudit.snapshot}</p>
          <a href="https://w3c-cg.github.io/music-notationref/">Open the W3C reference</a>
        </aside>
      </header>

      <section className="feature-support__summaries" aria-label="Coverage summary">
        <SummaryCard
          title="MNX format"
          summary={coverageAudit.summaries.mnx}
          note="Representation support reported by the W3C MNX notationref matrix at the audited snapshot."
        />
        <SummaryCard
          title="MusicXML format"
          summary={coverageAudit.summaries.musicXml}
          note="Representation support reported by the W3C MusicXML notationref matrix at the audited snapshot."
        />
        <SummaryCard
          title="Viritura MNX pipeline"
          summary={coverageAudit.summaries.virituraMnx}
          note="Ingested, modeled, and meaningfully engraved. Documented Viritura extensions count when fully implemented."
        />
        <SummaryCard
          title="Viritura MusicXML/MXL importer"
          summary={coverageAudit.summaries.virituraMxl}
          note="Coverage of Viritura's current converter implementation in packages/musicxml."
        />
      </section>

      <section className="feature-support__explorer" aria-labelledby="feature-support-explorer">
        <div className="feature-support__explorer-heading">
          <div>
            <Text as="p" variant="eyebrow" tone="muted">
              Complete reference
            </Text>
            <Text as="h2" id="feature-support-explorer" variant="title">
              Explore the coverage matrix
            </Text>
          </div>
          <p>
            Coverage reflects the audited source snapshot. Supported means supported for that column&apos;s scope, not
            automatically editor authoring, playback, export, or lossless round-trip support. MNX and MusicXML statuses
            mirror notationref; partial-gap explanations are maintained only for Viritura-owned columns.
          </p>
        </div>

        <div className="feature-support__filters" aria-label="Coverage filters">
          <label className="feature-support__search-filter">
            <span>Search</span>
            <SearchInput
              value={filters.query}
              onValueChange={(value) => updateFilter("query", value)}
              placeholder="Search concepts or notationref IDs"
              ariaLabel="Search"
              clearOnEscape
            />
          </label>
          <label>
            <span>Filter surface</span>
            <select
              value={filters.surface}
              onChange={(event) => updateFilter("surface", event.currentTarget.value as CoverageSurface)}
            >
              <option value="mnx">MNX</option>
              <option value="musicxml">MusicXML</option>
              <option value="viritura-mnx">Viritura MNX</option>
              <option value="viritura-mxl">Viritura MXL importer</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.currentTarget.value as CoverageFilters["status"])}
            >
              <option value="all">All statuses</option>
              <option value="S">Supported</option>
              <option value="P">Partial</option>
              <option value="N">Unsupported</option>
              {filters.surface === "viritura-mxl" && <option value="NA">Derived / not applicable</option>}
              <option value="?">Unknown upstream value</option>
            </select>
          </label>
          <button type="button" onClick={resetFilters}>
            Reset
          </button>
        </div>

        <details className="feature-support__methodology">
          <summary>
            <span>Audit methodology and known limitations</span>
            <small>{coverageAudit.findings.length} implementation notes</small>
          </summary>
          <div>
            <p>
              Existing documentation was treated as a lead rather than proof. Statuses were assigned from parser, model,
              layout, rendering, converter, fixture, and test source at the recorded snapshot. Partial labels describe
              the remaining boundary as a subset, approximation, lossy mapping, required extension, fixed style, or
              semantic gap. Upstream MNX and MusicXML descriptor text remains maintained by the W3C community and is not
              duplicated here.
            </p>
            <ul>
              {coverageAudit.findings.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
            <a href="https://github.com/Viritura/Viritura/blob/main/docs/spec/music-notationref-coverage.md">
              Read the complete source audit
            </a>
          </div>
        </details>

        <div className="feature-support__result-count" aria-live="polite">
          <span>
            <strong>{rows.length}</strong> matching concepts in {groupedRows.length}{" "}
            {groupedRows.length === 1 ? "group" : "groups"} · {coverageAudit.rows.length} total
          </span>
          <span className="feature-support__group-actions">
            <button type="button" onClick={expandAll}>
              Expand all
            </button>
            <button type="button" onClick={collapseAll}>
              Collapse all
            </button>
          </span>
        </div>
        {rows.length > 0 ? (
          <div className="feature-support__groups">
            {groupedRows.map((entry) => (
              <CoverageGroup
                key={entry.group}
                group={entry.group}
                rows={entry.rows}
                surface={filters.surface}
                open={openGroups.has(entry.group)}
                onOpenChange={(open) => setGroupOpen(entry.group, open)}
              />
            ))}
          </div>
        ) : (
          <div className="feature-support__empty">
            <h3>No concepts match these filters</h3>
            <p>Try a broader search or reset the coverage filters.</p>
          </div>
        )}
      </section>
    </div>
  );
}
