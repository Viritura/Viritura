import { Text } from "@viritura/ui";

const officialMnxUrl = "https://mnx.formats.music/docs/";

export function MnxGuide() {
  return (
    <section className="mnx-hub__guide" aria-labelledby="what-is-mnx-title">
      <div className="mnx-hub__guide-heading">
        <Text as="p" variant="eyebrow" tone="muted">
          About the format
        </Text>
        <Text as="h2" id="what-is-mnx-title" variant="title">
          What is MNX?
        </Text>
      </div>
      <div className="mnx-hub__guide-copy">
        <p>
          MNX is an emerging format for representing music notation as structured data. It records notes, rhythms,
          parts, and the relationships between them, so software can work with the music rather than a fixed picture of
          a page.
        </p>
        <p>
          MNX documents are written as JSON. Musical content is organized into source parts and measures, while
          score-wide information such as time signatures, repeats, and tempo has its own global timeline. The format can
          also describe how source music is arranged into staves for a score or instrumental part.
        </p>
        <p>
          The W3C Music Notation Community Group, which also maintains MusicXML, develops MNX in the open. MNX is still
          a draft. The <a href={officialMnxUrl}>official MNX specification</a> is the source for current definitions and
          implementation decisions.
        </p>
        <div className="mnx-hub__guide-actions">
          <a href="/mnx/playground#hello-world">Open a small MNX document</a>
          <a href={officialMnxUrl}>Read the official introduction</a>
        </div>
      </div>

      <div className="mnx-hub__comparison-heading">
        <Text as="p" variant="eyebrow" tone="muted">
          Two different jobs
        </Text>
        <Text as="h2" variant="title">
          MNX and MusicXML
        </Text>
      </div>
      <div className="mnx-hub__guide-copy">
        <p>
          MusicXML is the established interchange format for notation software. Its broad support makes it the practical
          choice when moving a score between existing applications.
        </p>
        <p>
          MNX is intended for interchange and for use as an application&apos;s working format. It represents
          relationships such as voices, chords, and tuplets more directly. The tradeoff is maturity and reach: MusicXML
          works with a large software ecosystem, while MNX is still a draft with limited support.
        </p>
        <p>
          In Viritura, MusicXML is an import format for bringing in an existing score. MNX is the document Viritura
          works in after import.
        </p>
        <div className="mnx-hub__guide-actions">
          <a href="/mnx/mxl-converter">Compare the formats and convert a score</a>
        </div>
      </div>

      <div className="mnx-hub__questions" aria-labelledby="mnx-questions-title">
        <Text as="p" variant="eyebrow" tone="muted">
          Common questions
        </Text>
        <Text as="h2" id="mnx-questions-title" variant="title">
          A few useful distinctions
        </Text>
        <dl>
          <div>
            <dt>What does MNX stand for?</dt>
            <dd>
              MNX is the name of the format. The official documentation does not expand it into a longer phrase. The X
              does not mean that MNX is an XML format.
            </dd>
          </div>
          <div>
            <dt>Is MNX replacing MusicXML?</dt>
            <dd>
              Not in the practical sense that applications should stop supporting MusicXML. MusicXML remains the common
              route for exchanging scores today. MNX is newer work by the same community with a different model and a
              broader goal.
            </dd>
          </div>
          <div>
            <dt>Where can I find MNX examples?</dt>
            <dd>
              The <a href="/mnx/playground">Viritura Playground</a> includes a featured sample and 52 examples from the
              MNX documentation, each editable beside its rendered score. The{" "}
              <a href="/mnx/examples">example library</a>
              is broader, adding Viritura extensions and engraving behavior cases in Storybook.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
