import type { Preview } from "@storybook/react-vite";
/// <reference path="./css.d.ts" />

import { createElement } from "react";
import { TooltipPrimitives } from "@viritura/ui";
import "@viritura/ui/tokens.css";
import "@viritura/ui/reset.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    options: {
      storySort: {
        order: [
          "MNX Spec",
          [
            "Notes & Rests",
            [
              "Pitch",
              "Accidentals",
              "Rests",
              "Multi-Measure Rests",
              "Grace Notes",
              "Grace-Note Timing",
              "Stem Direction",
              "Cross-Staff Notes",
              "Custom Note Glyphs",
              "*",
            ],
            "Rhythm & Beaming",
            [
              "Beams",
              "Beam Hooks",
              "Rhythmic Spaces",
              "Tuplet Examples",
              "Tuplet Display",
              "Multiple Voices",
              "Voice and Tuplet Direction",
              "Beat Alignment",
              "*",
            ],
            "Slurs, Ties & Spanners",
            [
              "Slurs",
              ["Basics", "Chord Slurs", "Line Types", "*"],
              "Ties",
              ["Basics", "Placement and Laissez Vibrer", "*"],
              "Hairpins",
              "Ottavas",
              "Tremolos",
              "*",
            ],
            "Articulations & Marks",
            ["Articulations", "Arpeggios", "Bowing Marks", "Breath Marks", "Fermatas", "*"],
            "Dynamics & Tempo",
            ["Dynamics", "Tempo", "*"],
            "Clefs, Keys & Meter",
            ["Clefs", "Key Signatures", "Time Signatures", "*"],
            "Barlines, Repeats & Navigation",
            ["Barlines", "Repeats", "Measure Repeats", "Navigation Jumps", "*"],
            "Text & Labels",
            ["Lyrics", "Measure Numbers", "*"],
            "Instruments & Parts",
            ["Transposition", "Percussion", "*"],
            "Layout & Scores",
            ["System Layout", "*"],
            "Appearance",
            ["Color", "*"],
            "*",
          ],
          "Viritura Extensions",
          [
            "Expressions & Labels",
            ["Chord Symbols", "Text Expressions", "Rehearsal Marks", "*"],
            "Techniques & Ornaments",
            ["Ornaments", "Trills", "Fingerings", "Glissandi", "Pedal Marks", "*"],
            "Breaks & Pauses",
            ["Caesuras", "*"],
            "Percussion",
            ["Drum Kit Noteheads", "*"],
            "Meter & Layout",
            ["Time Signature Styles", "*"],
            "*",
          ],
          "Engraving Behavior",
          [
            "Notes, Stems & Voices",
            ["Beam-Hook Direction", "Clef Changes", "Cross-Staff Notation", "*"],
            "Rhythm & Spacing",
            [
              "Beat Alignment",
              "Grace-Note Beaming",
              "Tuplet Placement",
              "Tuplet Clearance and Beaming",
              "Multi-Measure Rest Clearance",
              "*",
            ],
            "Slurs & Ties",
            [
              "Shape and Placement",
              "Span and Register",
              "Note Interactions",
              "Articulation Clearance",
              "Phrasing and Nesting",
              "Beam, Tie and Chord Interactions",
              "Stress Cases",
              "*",
            ],
            "Articulations & Marks",
            ["Articulations with Ties", "Combined Markings", "Fermata Placement", "Ornament Clearance", "*"],
            "Dynamics & Hairpins",
            ["Dynamic Placement", "Hairpin Clearance and Alignment", "*"],
            "Text & Directions",
            ["Tempo Placement", "Rehearsal-Mark Placement", "*"],
            "Staves, Systems & Scores",
            [
              "Measure Numbers",
              "Braces",
              "Condensing",
              "Large Scores",
              ["Beethoven's Fifth Finale", "Orchestral Score", "*"],
              "*",
            ],
            "*",
          ],
          "*",
        ],
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  // Hoisted Tooltip provider mirrors AppShell so every primitive that uses
  // `withTooltip` works inside stories without per-story setup.
  decorators: [
    (Story) =>
      createElement(TooltipPrimitives.Provider, { delayDuration: 400, skipDelayDuration: 100 }, createElement(Story)),
  ],
};

export default preview;
