import { useState } from "react";

interface FeatureItem {
  name: string;
  description: string;
}

const VENDOR_COVERED: FeatureItem[] = [
  { name: "Trill", description: "Trill marks on notes" },
  { name: "Mordent / Inverted Mordent", description: "Mordent ornament symbols" },
  { name: "Turn / Delayed Turn / Inverted Turn", description: "Turn ornament variants" },
  { name: "Shake", description: "Shake ornament" },
  { name: "Caesura", description: "Breath/caesura marks between notes" },
  { name: "Arpeggiate", description: "Rolled-chord indication with direction" },
  { name: "Rehearsal Marks", description: "Rehearsal letters/numbers above the staff" },
  { name: "Text Expressions", description: "Expressive text (dolce, espressivo, etc.)" },
  { name: "Pedal Markings", description: "Piano sustain pedal start/stop" },
  { name: "Hairpins / Wedges", description: "Crescendo and diminuendo wedge lines" },
  { name: "Fingerings", description: "Finger number annotations on notes" },
  { name: "Score Metadata", description: "Title, subtitle, composer, lyricist, arranger, work/movement info" },
];

const NOT_COVERED: FeatureItem[] = [
  { name: "Glissando / Slide", description: "Glissando and slide lines between notes" },
  { name: "Chord Symbols", description: "Chord names above the staff (e.g. Cmaj7)" },
  { name: "Technical Notations", description: "Up-bow, down-bow, harmonics, etc." },
  { name: "Bend", description: "Guitar bend notation" },
  { name: "Color / Font Styling", description: "Element colors, font families, and sizes" },
  { name: "Coda", description: "Coda sign (approximated as segno in MNX)" },
];

export function UnsupportedFeaturesPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="features-panel">
      <button className="features-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="features-toggle-icon">{open ? "▾" : "▸"}</span>
        MusicXML features not in the MNX spec
        <span className="features-count">{VENDOR_COVERED.length + NOT_COVERED.length} features</span>
      </button>

      {open && (
        <div className="features-content">
          <div className="features-section">
            <h4 className="features-section-title covered">
              <span className="features-dot covered" />
              Covered by Viritura vendor extensions
              <span className="features-badge covered">{VENDOR_COVERED.length}</span>
            </h4>
            <p className="features-section-hint">
              Enable the toggle above to include these as <code>_x.viritura</code> data
            </p>
            <ul className="features-list">
              {VENDOR_COVERED.map((f) => (
                <li key={f.name} className="features-item">
                  <strong>{f.name}</strong>
                  <span>{f.description}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="features-section">
            <h4 className="features-section-title not-covered">
              <span className="features-dot not-covered" />
              Not supported — silently dropped
              <span className="features-badge not-covered">{NOT_COVERED.length}</span>
            </h4>
            <p className="features-section-hint">
              These MusicXML features have no MNX equivalent and are not preserved
            </p>
            <ul className="features-list">
              {NOT_COVERED.map((f) => (
                <li key={f.name} className="features-item">
                  <strong>{f.name}</strong>
                  <span>{f.description}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
