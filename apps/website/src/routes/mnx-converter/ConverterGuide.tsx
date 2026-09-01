export function ConverterGuide() {
  return (
    <article className="converter-guide" aria-labelledby="converter-guide-title">
      <header className="converter-guide__heading">
        <span className="converter-section-kicker">About the conversion</span>
        <h2 id="converter-guide-title">Why convert MusicXML to MNX?</h2>
        <p>
          MusicXML is how scores move between most notation applications. MNX is the working format used by Viritura.
          This converter reads the musical structure in a MusicXML file, maps supported notation into MNX, and reports
          source details that need review.
        </p>
      </header>

      <section aria-labelledby="format-differences-title">
        <h2 id="format-differences-title">How MusicXML and MNX differ</h2>
        <p>
          MusicXML is XML designed first for exchange between notation programs. Its structure uses an ordered stream of
          notes and directions. MNX uses JSON and makes several musical relationships explicit: voices are sequences,
          notes sounding together belong to one event, and objects such as ties and slurs can point to their
          destinations.
        </p>
        <div className="converter-guide__details">
          <div>
            <h3>Chords</h3>
            <p>
              MusicXML writes chord notes as adjacent note elements and marks the later notes as part of the chord. MNX
              places the notes together in one event, with one duration and rhythmic position.
            </p>
          </div>
          <div>
            <h3>Voices</h3>
            <p>
              MusicXML can move its reading position backward to begin another voice. MNX stores simultaneous voices as
              separate sequences within the measure.
            </p>
          </div>
          <div>
            <h3>Tuplets</h3>
            <p>
              MusicXML describes tuplet timing on notes and uses start and stop notation for the visible group. MNX
              represents a tuplet as a container with its own content and rhythmic relationship.
            </p>
          </div>
          <div>
            <h3>Layouts</h3>
            <p>
              MusicXML carries print and positioning information for reconstructing an exported score. MNX can define
              layouts separately from source parts, allowing the same music to be arranged in more than one form.
            </p>
          </div>
        </div>
        <p>
          MusicXML has broad support and remains the safer choice for exchange between existing notation applications.
          MNX has a more direct shape for many relationships and is intended to be usable as a working document, but it
          is still a draft with a much smaller software ecosystem.
        </p>
      </section>

      <section aria-labelledby="converter-coverage-title">
        <h2 id="converter-coverage-title">What carries into MNX</h2>
        <p>
          The converter handles the basic structure needed to keep working on a score: parts and staves, notes and
          rests, chords, multiple voices, tuplets, ties, slurs, lyrics, clefs, key and time signatures, tempo, repeats,
          and common articulations. It also maps supported transposing instruments and multi-staff parts.
        </p>
        <p>
          Some source details do not have a standard MNX equivalent. With Viritura extensions enabled, supported details
          can be retained in <code>_x.viritura</code> data. The <strong>Extensions and import limitations</strong> panel
          above is the maintained feature list. It separates extension-backed details, incomplete mappings, and source
          details that are not preserved.
        </p>
      </section>

      <section aria-labelledby="converter-settings-guide-title">
        <h2 id="converter-settings-guide-title">Choose the output you want</h2>
        <div className="converter-guide__details">
          <div>
            <h3>Viritura extensions</h3>
            <p>
              Leave extensions on when the destination is Viritura and retaining supported source-specific notation
              matters. Turn them off to produce strict MNX output.
            </p>
          </div>
          <div>
            <h3>Stem directions</h3>
            <p>
              Keep explicit MusicXML stems to follow the source, or ask Viritura to recompute them from voice and pitch.
              Stemless and double-stemmed events need review.
            </p>
          </div>
          <div>
            <h3>Tempo text</h3>
            <p>
              Keep the numeric metronome value visible, or retain it for playback while written tempo text leads the
              printed result.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="conversion-review-title">
        <h2 id="conversion-review-title">Review before you continue</h2>
        <p>
          Preview shows whether the converted score looks right. Validation checks the output against the MNX JSON
          Schema. Diagnostics list details omitted or approximated for the selected file. MNX Output shows the generated
          document itself.
        </p>
        <p>
          A valid MNX document can still differ from the source. Use the preview and diagnostics together before
          treating the conversion as finished.
        </p>
      </section>

      <section className="converter-guide__questions" aria-labelledby="converter-questions-title">
        <h2 id="converter-questions-title">Common questions</h2>
        <details>
          <summary>What is an MXL file?</summary>
          <p>
            An <code>.mxl</code> file is compressed MusicXML. It contains the same kind of notation data as an
            uncompressed MusicXML document, packaged into a smaller file for sharing.
          </p>
        </details>
        <details>
          <summary>Can the converter open Finale files?</summary>
          <p>
            It cannot open Finale <code>.mus</code> or <code>.musx</code> files directly. Export the score from Finale
            as MusicXML 4.0 or compressed MusicXML, then open that exported file here.
          </p>
        </details>
        <details>
          <summary>Will the MNX score look exactly like the original?</summary>
          <p>
            Not necessarily. Pitches, rhythms, and basic score structure often transfer more reliably than individually
            positioned items. Review the preview and diagnostics before treating the result as finished.
          </p>
        </details>
        <details>
          <summary>Does conversion upload my score?</summary>
          <p>No. Conversion and preview run locally in the browser. Your files stay on your device.</p>
        </details>
      </section>
    </article>
  );
}
