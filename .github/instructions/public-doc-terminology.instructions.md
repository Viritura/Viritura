---
description: Use musician-facing language without requiring knowledge of MNX internals
applyTo: "{docs/guide/**/*.md,apps/website/src/routes/docs/**/*.{ts,tsx},apps/editor/src/components/HelpDialog.tsx}"
---

# Public documentation terminology

Public guides are written for musicians. Describe scores, instrumental parts,
layouts, and instruments in terms of what users see and do, without requiring
knowledge of MNX or its data model. Name MNX, `.mnx`, or other formats when
needed for file workflows or to match a UI label.

- **document** means the whole piece and its settings;
- **instrument** means the instrument and its music in the document;
- **layout** describes which instruments and staves appear and how they are
  arranged;
- **score**, **section score**, **instrumental part**, and **part extract**
  describe the views musicians use.

Keep the underlying distinction accurate: an MNX source part is not necessarily
a printed part, and an MNX score definition can describe either a score or an
instrumental part. Explain those schema concepts in technical documentation,
not as prerequisites for using the editor.

## Learnings

Prefer “the instrument's music appears in the score and its part” to explaining
how MNX source parts and score definitions relate. Mention file formats when
they help a musician choose, open, save, import, or export a file.
