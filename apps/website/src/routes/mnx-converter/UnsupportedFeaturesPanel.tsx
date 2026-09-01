import { useState } from "react";
import {
  LIMITED_MUSICXML_COVERAGE,
  SUPPORTED_TARGET_IMPORT_GAPS,
  VIRITURA_EXTENSION_COVERAGE,
  type ConversionCoverageItem,
} from "./conversionCoverage";

interface CoverageSectionProps {
  title: string;
  hint: string;
  items: readonly ConversionCoverageItem[];
  status: "covered" | "pending" | "limited";
}

function CoverageSection({ title, hint, items, status }: CoverageSectionProps) {
  return (
    <div className="features-section">
      <h4 className={`features-section-title ${status}`}>
        <span className={`features-dot ${status}`} />
        {title}
        <span className={`features-badge ${status}`}>{items.length}</span>
      </h4>
      <p className="features-section-hint">{hint}</p>
      <ul className="features-list">
        {items.map((feature) => (
          <li key={feature.name} className="features-item">
            <strong>{feature.name}</strong>
            <span>{feature.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UnsupportedFeaturesPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="features-panel">
      <button className="features-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="features-toggle-icon">{open ? "▾" : "▸"}</span>
        Extensions and import limitations
        <span className="features-count">
          {VIRITURA_EXTENSION_COVERAGE.length + SUPPORTED_TARGET_IMPORT_GAPS.length + LIMITED_MUSICXML_COVERAGE.length}{" "}
          areas
        </span>
      </button>

      {open && (
        <div className="features-content">
          <CoverageSection
            title="Preserved with Viritura extensions"
            hint="Enable Viritura extensions to retain these rendered details."
            items={VIRITURA_EXTENSION_COVERAGE}
            status="covered"
          />
          <CoverageSection
            title="Supported, but not fully imported"
            hint="MNX or Viritura can represent these features; the MusicXML mapping is incomplete."
            items={SUPPORTED_TARGET_IMPORT_GAPS}
            status="pending"
          />
          <CoverageSection
            title="Not preserved"
            hint="These source details have no implemented conversion target and are dropped."
            items={LIMITED_MUSICXML_COVERAGE}
            status="limited"
          />
        </div>
      )}
    </div>
  );
}
