# Lyric extenders

MNX lyric extenders are word-extension lines attached to an event lyric line.
They are independent of syllabic hyphens: `type: "start"` and `type: "middle"`
continue a hyphenated word and do not, by themselves, create an extender.
The examples use document version `1`; the MNX schema revision does not change
the document's `mnx.version` value.

```json
{
  "id": "syllable",
  "lyrics": {
    "lines": {
      "1": {
        "text": "love",
        "extender": {
          "id": "word-line",
          "show": true,
          "target": "last-covered-event",
          "_c": "optional MNX comment",
          "_x": {
            "example": { "annotation": "retained" }
          }
        }
      }
    }
  }
}
```

In a complete document the event lyric object is nested inside the score's
part/measure/sequence content, and the root uses `"mnx":{"version":1}`.

`extender.show` is optional and defaults to `true` when the `extender` object
is present. `show: false` suppresses the line and ignores its target.
`extender.target`, when present, names the last covered event; its full
notated duration is included. Missing targets are invalid, and targets that
run backward or cross a later syllable on the same lyric line are diagnosed.
The extender object's own `id`, `_c`, and `_x` global attributes are retained
through parsing and serialization.

When `mnx.support.useLyricExtenders` is `true`, the document uses explicit
extender intent: an absent `extender` does not create a line. When the flag is
absent or `false`, eligible terminal syllables may infer an extender through
subsequent events in the same voice, stopping at a rest or the next syllable
on that lyric line. Tied continuation notes remain eligible textless events;
the extender is independent of note tie notation. Explicit `extender` objects
are honored in either mode.

Automatic inference follows the sequence's named `voice` within its part and
staff, even when sequence arrays are reordered between measures. Unnamed
sequences retain positional continuity. Native rendering does not require
optional event IDs for inferred extenders; their selection tags use the same
positional fallback as the lyric text.

The renderer carries a resolved extender across every system containing its
source-to-target range, including system and page breaks. The visible lyric
text remains on the source event, and the line is selectable through that
lyric element. Retained system identities include a conservative score-wide
lyric dependency hash, so remote endpoint edits and inference-boundary changes
cannot reuse stale line segments. MusicXML `<extend type="start|continue|stop">`
boundaries map to one explicit MNX extender from the starting syllable through
the stopping event.

MusicXML may mix explicit `<extend>` elements with ordinary lyric syllables.
The importer enables `useLyricExtenders` only when every imported lyric line
declares an extender; otherwise it preserves the inferred policy for omitted
extenders. Untyped `<extend/>` starts a line, and continuation/stop nodes do
not create empty lyric syllables.

Clipboard copies remap endpoints inside the copied tracks together. References
outside the fragment remain authored references rather than silently becoming
inferred endpoints. A paste into a different score may therefore have a missing
or backward target, reported by the normal extender-reference diagnostics.
No Viritura-specific extender payload is defined; `_x` can retain other vendors'
metadata without treating it as an implemented Viritura extension.

Splitting an event keeps syllables on the onset fragment and moves incoming
extender references to the final fragment; joining remaps them to the surviving
event. Hidden extenders keep their targets and metadata through these operations.
Fragments snapshot the current transactional edit, including in-flight lyric and
duration changes, rather than cloning a draft proxy or the pre-edit event.
Reference remapping inspects unchanged score branches without drafting unrelated
events, and identity-only mappings do not traverse the score.
