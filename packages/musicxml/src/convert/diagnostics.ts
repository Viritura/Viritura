import { DiagnosticCollector, ptr } from "@viritura/core";

/**
 * Scan the MusicXML root for constructs that this converter drops or
 * approximates, and emit one diagnostic per kind (deduplicated by element
 * name). Generic shape — pointers reference the XML element name rather
 * than a specific element index, since the resulting MNX doc may not have
 * a 1:1 location for the dropped data.
 */
export function collectLossyDiagnostics(root: Element, dx: DiagnosticCollector, vendorExt: boolean): void {
  const all = root.getElementsByTagName("*");
  const counts: Record<string, number> = {};
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (!el) continue;
    const tag = el.tagName;
    counts[tag] = (counts[tag] ?? 0) + 1;
  }

  const note = (tag: string, severity: "info" | "warning", message: string, code: string) => {
    const n = counts[tag];
    if (!n) return;
    dx.emit({
      pointer: ptr(tag),
      message: n > 1 ? `${message} (${n} occurrences)` : message,
      severity,
      code,
    });
  };

  // Always lossy regardless of vendor-extension toggle.
  note("harmony", "warning", "Chord symbols dropped (no MNX representation)", "musicxml-harmony");
  note("figured-bass", "warning", "Figured bass dropped", "musicxml-figured-bass");
  note("bend", "warning", "Guitar bend dropped", "musicxml-bend");
  note("coda", "info", "Coda mapped to MNX segno (closest spec equivalent)", "musicxml-coda");

  // Stem variants we can't represent.
  let stemNone = 0;
  let stemDouble = 0;
  const stems = root.getElementsByTagName("stem");
  for (let i = 0; i < stems.length; i++) {
    const t = (stems[i]?.textContent ?? "").trim();
    if (t === "none") stemNone++;
    else if (t === "double") stemDouble++;
  }
  if (stemNone > 0) {
    dx.emit({
      pointer: ptr("stem"),
      message: `<stem>none</stem> (stemless) dropped — MNX has no stemless representation (${stemNone} occurrences)`,
      severity: "warning",
      code: "musicxml-stem-none",
    });
  }
  if (stemDouble > 0) {
    dx.emit({
      pointer: ptr("stem"),
      message: `<stem>double</stem> dropped (${stemDouble} occurrences)`,
      severity: "warning",
      code: "musicxml-stem-double",
    });
  }

  // Conditionally lossy — only without the vendor-extension toggle.
  if (!vendorExt) {
    note("glissando", "info", "Glissandos dropped — enable vendor extensions to preserve", "musicxml-glissando");
    note("slide", "info", "Slides dropped — enable vendor extensions to preserve", "musicxml-slide");
    note("trill-mark", "info", "Trill marks dropped — enable vendor extensions to preserve", "musicxml-trill");
    note("mordent", "info", "Mordents dropped — enable vendor extensions to preserve", "musicxml-mordent");
    note(
      "inverted-mordent",
      "info",
      "Inverted mordents dropped — enable vendor extensions to preserve",
      "musicxml-mordent",
    );
    note("turn", "info", "Turns dropped — enable vendor extensions to preserve", "musicxml-turn");
    note("inverted-turn", "info", "Inverted turns dropped — enable vendor extensions to preserve", "musicxml-turn");
    note("delayed-turn", "info", "Delayed turns dropped — enable vendor extensions to preserve", "musicxml-turn");
    note("shake", "info", "Shake ornaments dropped — enable vendor extensions to preserve", "musicxml-shake");
    note("caesura", "info", "Caesuras dropped — enable vendor extensions to preserve", "musicxml-caesura");
    note("arpeggiate", "info", "Arpeggios dropped — enable vendor extensions to preserve", "musicxml-arpeggio");
    note("non-arpeggiate", "info", "Non-arpeggios dropped — enable vendor extensions to preserve", "musicxml-arpeggio");
    note("rehearsal", "info", "Rehearsal marks dropped — enable vendor extensions to preserve", "musicxml-rehearsal");
    note("words", "info", "Text expressions dropped — enable vendor extensions to preserve", "musicxml-words");
    note("pedal", "info", "Pedal markings dropped — enable vendor extensions to preserve", "musicxml-pedal");
    note("fingering", "info", "Fingerings dropped — enable vendor extensions to preserve", "musicxml-fingering");
  }
}
