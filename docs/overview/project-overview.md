# Project Overview — Web-Native Collaborative Music Notation

## Project Codename: **Viritura**

## Vision

Build a modern, web-native music notation editor that enables real-time collaboration between composers, arrangers, and musicians — eliminating the need to exchange binary files and enabling Git-like version control over musical scores.

## Why This Exists

### Problems with Current Tools

| Problem                                             | Impact                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Binary file formats** (.mscz, .sibelius, .dorico) | Cannot be meaningfully diffed, merged, or version-controlled                               |
| **No real-time collaboration**                      | Composers email/share binary files back and forth; conflicts are resolved manually         |
| **Desktop-only**                                    | Requires installation, OS-specific builds, heavyweight C++ runtimes                        |
| **Vendor lock-in**                                  | Proprietary formats make switching tools costly                                            |
| **No web presence**                                 | Sharing a score means exporting PDF — readers can't interact, play back, or comment inline |

### What We Build

A **performant, browser-based notation editor** with:

1. **Real-time multiplayer editing** — multiple users edit the same score simultaneously (Google Docs for music)
2. **Text-based score format** — MNX JSON works with Git, enabling branching, merging, and pull requests on musical content
3. **Web-first with offline support** — local projects remain available through browser storage and sync when reconnected
4. **High-fidelity engraving** — publication-quality rendering through the Rust layout engine and Canvas 2D
5. **Integrated playback** — Web Audio API-based synthesis and sample playback
6. **Extensible data model** — application features use documented `_x.viritura` MNX extensions
7. **Open standard compatible** — MNX editing and MusicXML import; the native format is open and documented

**Our differentiator:** combine version-control-friendly score data, real-time
collaboration, and publication-quality engraving in one web-native editor.

## Core Design Principles

1. **Collaboration-first** — Every architectural decision assumes multiple concurrent editors. The data model must be CRDT-friendly from day one.
2. **Text-native format** — The canonical score representation is human-readable, diffable, and mergeable — enabling Git workflows.
3. **Performance parity** — Rendering and interaction must feel native. We use WebAssembly, retained layout state, and Canvas caching.
4. **Offline-capable** — Works fully offline; syncs collaboratively when online.
5. **Standards-based** — Use MNX natively, import MusicXML, and map cleanly to SMuFL and W3C music notation standards.
6. **Progressive complexity** — Simple scores are simple to create. Advanced features (figured bass, graphical notation, microtonal) available but not in the way.
7. **Extensible** — Documented vendor extensions support notation, analysis, playback, and reviewed AI proposals.

## Target Users

- **Composers & Arrangers** — Professional and amateur score creation
- **Music Educators** — Create and share exercises, grade student submissions
- **Ensembles & Bands** — Collaborative part preparation, rehearsal marks, annotations
- **Music Publishers** — Publication-quality output with version-tracked editorial workflows
- **Music Theorists** — Analytical annotations, custom notation systems

## Success Metrics

- Sub-100ms latency for note input to visual feedback
- Sub-500ms sync time for collaborative edits
- Publication-quality engraving (validated against standard reference scores)
- Full offline functionality with sync-on-reconnect
- MusicXML round-trip fidelity ≥ 95%
