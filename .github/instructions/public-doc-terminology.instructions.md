---
description: Keep public documentation terminology distinct from MNX schema object names
applyTo: "{docs/guide/**/*.md,apps/website/src/routes/docs/**/*.{ts,tsx},apps/editor/src/components/HelpDialog.tsx}"
---

# Public documentation terminology

Public guides use musician-facing language by default. Follow the terminology
contract in `docs/guide/instruments-and-scores.md#terminology`:

- **document** means the whole `.mnx` file;
- **MNX part** or **source part** means the schema object that owns music;
- **MNX score definition** means the schema object that selects a layout and
  can render either a score or an instrumental part;
- **layout** means the staff/group tree that maps source parts into an output;
- **score**, **section score**, **instrumental part**, and **part extract** mean
  musician-facing rendered outputs.

Never call an MNX source part a printed part, and never imply that an MNX
`score` definition is necessarily a conductor score. Prefer “the document
stores…” over “the score stores…” when describing file-level data.

Example: write “The document contains one Flute source part, and separate MNX
score definitions render it in the full score and Flute 1 instrumental part.”
Do not write “The Flute part appears in two scores” unless the surrounding text
has already made the data-model meaning explicit.
