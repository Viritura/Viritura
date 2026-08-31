//! SMuFL glyph codepoints for music notation symbols.
//!
//! Standard Music Font Layout (SMuFL) Unicode codepoints.
//! These work with any SMuFL-compliant font.
//! Reference: https://w3c.github.io/smufl/latest/

/// SMuFL glyph codepoints used by the renderer.
#[allow(clippy::module_inception)] // public module name `smufl` is the well-known external identifier (Standard Music Font Layout); call sites use `crate::render::smufl::smufl::<GLYPH>`.
pub mod smufl {
    // ═══════════════════════════════════════
    // Brackets and Braces (U+E000 - U+E00F)
    // SMuFL spec Section 4.1: Staff brackets and dividers
    // ═══════════════════════════════════════
    pub const BRACE: u32 = 0xE000;
    /// Brace glyph design height in staff spaces (from Bravura metadata bBoxNE.y - bBoxSW.y).
    /// Used to scale the brace font size so it spans exactly the desired height.
    pub const BRACE_GLYPH_HEIGHT: f64 = 3.988;
    /// Brace glyph design width in staff spaces (from Bravura metadata bBoxNE.x).
    /// Used to compute the rendered width and position the brace so it doesn't overlap staves.
    pub const BRACE_GLYPH_WIDTH: f64 = 0.328;

    // ── Brace stylistic alternates ─────────────────────────────────
    //
    // SMuFL's implementation notes for staff brackets: the brace glyph is one
    // em tall (a single five-line staff) and is scaled proportionally to the
    // height of the staves it encompasses, and fonts may ship alternates
    // "designed to accommodate larger distances, to avoid the standard brace
    // glyph becoming too wide and bold at larger sizes". Bravura's four
    // alternates plus the default cover one staff up to ten or more.
    //
    // All five are cut to the same one-em height and differ only in how wide
    // and how deeply curved they are, so the choice is purely about which
    // design carries the span. Widths below are the glyphs' own right-edge
    // bounds in staff spaces, measured from Bravura; they are not in the
    // font's metadata because the alternates live in the Private Use Area.
    /// `braceSmall` (uniE000.salt01) — the widest cut, for a one-staff brace.
    pub const BRACE_SMALL: u32 = 0xF400;
    pub const BRACE_SMALL_WIDTH: f64 = 0.412;
    /// `braceLarge` (uniE000.salt02).
    pub const BRACE_LARGE: u32 = 0xF401;
    pub const BRACE_LARGE_WIDTH: f64 = 0.268;
    /// `braceLarger` (uniE000.salt03).
    pub const BRACE_LARGER: u32 = 0xF402;
    pub const BRACE_LARGER_WIDTH: f64 = 0.240;
    /// `braceFlat` (uniE000.salt04) — the flattest cut, for the tallest groups.
    pub const BRACE_FLAT: u32 = 0xF403;
    pub const BRACE_FLAT_WIDTH: f64 = 0.224;

    /// Bracket top terminal glyph. Per SMuFL spec Section 4.1:
    /// "use bracketTop and bracketBottom as the top and bottom terminals of a
    /// bracket drawn using a stroked line or filled rectangle."
    pub const BRACKET_TOP: u32 = 0xE003;
    /// Bracket bottom terminal glyph.
    pub const BRACKET_BOTTOM: u32 = 0xE004;
    /// Bracket terminal glyph height in staff spaces (from Bravura bBoxNE.y = 1.18).
    pub const BRACKET_TERMINAL_HEIGHT: f64 = 1.18;
    /// Bracket line thickness in staff spaces (from Bravura engravingDefaults.bracketThickness).
    pub const BRACKET_THICKNESS: f64 = 0.5;
    /// Line bracket thickness in staff spaces (from Bravura engravingDefaults.subBracketThickness).
    /// Used for nested brackets that auto-render as thin lines.
    pub const LINE_BRACKET_THICKNESS: f64 = 0.16;

    // ═══════════════════════════════════════
    // Noteheads (U+E0A0 - U+E0FF)
    // ═══════════════════════════════════════
    pub const NOTEHEAD_DOUBLE_WHOLE: u32 = 0xE0A0;
    pub const NOTEHEAD_WHOLE: u32 = 0xE0A2;
    pub const NOTEHEAD_HALF: u32 = 0xE0A3;
    pub const NOTEHEAD_BLACK: u32 = 0xE0A4;
    // Percussion / shape noteheads (SMuFL U+E0A5 - U+E0DF)
    pub const NOTEHEAD_X_DOUBLE_WHOLE: u32 = 0xE0A6;
    pub const NOTEHEAD_X_WHOLE: u32 = 0xE0A7;
    pub const NOTEHEAD_X_HALF: u32 = 0xE0A8;
    pub const NOTEHEAD_X_BLACK: u32 = 0xE0A9;
    pub const NOTEHEAD_PLUS_DOUBLE_WHOLE: u32 = 0xE0AA;
    pub const NOTEHEAD_PLUS_WHOLE: u32 = 0xE0AB;
    pub const NOTEHEAD_PLUS_HALF: u32 = 0xE0AC;
    pub const NOTEHEAD_PLUS_BLACK: u32 = 0xE0AD;
    pub const NOTEHEAD_CIRCLE_X_DOUBLE_WHOLE: u32 = 0xE0B0;
    pub const NOTEHEAD_CIRCLE_X_WHOLE: u32 = 0xE0B1;
    pub const NOTEHEAD_CIRCLE_X_HALF: u32 = 0xE0B2;
    pub const NOTEHEAD_CIRCLE_X: u32 = 0xE0B3;
    pub const NOTEHEAD_DIAMOND_DOUBLE_WHOLE: u32 = 0xE0D7;
    pub const NOTEHEAD_DIAMOND_WHOLE: u32 = 0xE0D8;
    pub const NOTEHEAD_DIAMOND_HALF: u32 = 0xE0D9;
    pub const NOTEHEAD_DIAMOND_BLACK: u32 = 0xE0DB;
    pub const NOTEHEAD_TRIANGLE_UP_DOUBLE_WHOLE: u32 = 0xE0BC;
    pub const NOTEHEAD_TRIANGLE_UP_WHOLE: u32 = 0xE0BD;
    pub const NOTEHEAD_TRIANGLE_UP_HALF: u32 = 0xE0BE;
    pub const NOTEHEAD_TRIANGLE_UP_BLACK: u32 = 0xE0BF;
    pub const NOTEHEAD_TRIANGLE_DOWN_DOUBLE_WHOLE: u32 = 0xE0C3;
    pub const NOTEHEAD_TRIANGLE_DOWN_WHOLE: u32 = 0xE0C4;
    pub const NOTEHEAD_TRIANGLE_DOWN_HALF: u32 = 0xE0C5;
    pub const NOTEHEAD_TRIANGLE_DOWN_BLACK: u32 = 0xE0C7;
    pub const NOTEHEAD_SLASH_VERTICAL_DOUBLE_WHOLE: u32 = 0xE100;
    pub const NOTEHEAD_SLASH_VERTICAL_WHOLE: u32 = 0xE101;
    pub const NOTEHEAD_SLASH_VERTICAL_HALF: u32 = 0xE102;
    pub const NOTEHEAD_SLASH_VERTICAL_BLACK: u32 = 0xE103;

    // ═══════════════════════════════════════
    // Notehead anchor points (from Bravura glyphsWithAnchors)
    // ═══════════════════════════════════════
    /// stemUpSE anchor for noteheadBlack/noteheadHalf: right edge of up-stem rectangle [x, y] in staff spaces.
    /// Y is negated from SMuFL (Y-up) to screen coordinates (Y-down).
    pub const STEM_UP_SE: (f64, f64) = (1.18, -0.168);
    /// stemDownNW anchor for noteheadBlack/noteheadHalf: left edge of down-stem rectangle [x, y] in staff spaces.
    /// Y is negated from SMuFL (Y-up) to screen coordinates (Y-down).
    pub const STEM_DOWN_NW: (f64, f64) = (0.0, 0.168);
    /// noteheadOrigin for noteheadDoubleWhole: left edge of actual notehead body [x, y] in staff spaces.
    pub const NOTEHEAD_DOUBLE_WHOLE_ORIGIN: (f64, f64) = (0.36, 0.0);

    /// Per-notehead stem attachment anchors (SMuFL `glyphsWithAnchors`),
    /// converted to screen coordinates (Y-down; SMuFL is Y-up so each Y is
    /// negated). `up_se` is the `stemUpSE` corner — up-stems sit on the right of
    /// the notehead; `down_nw` is the `stemDownNW` corner — down-stems sit on the
    /// left. Unlike a single global offset, these vary per shape: an X notehead
    /// attaches near its outer corners (±0.44sp), a triangle attaches at its flat
    /// edge (the same Y for up and down), and a diamond/circle-X attaches at the
    /// vertical center (0). Values transcribed from `bravura_metadata.json`.
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub struct StemAnchors {
        /// `stemUpSE`: bottom-right corner of an up-stem rectangle (right-side stem).
        pub up_se: (f64, f64),
        /// `stemDownNW`: top-left corner of a down-stem rectangle (left-side stem).
        pub down_nw: (f64, f64),
    }

    /// Default oval-notehead anchors (noteheadBlack / noteheadHalf).
    const STEM_ANCHORS_DEFAULT: StemAnchors = StemAnchors {
        up_se: STEM_UP_SE,
        down_nw: STEM_DOWN_NW,
    };

    /// Stem attachment anchors for a notehead glyph. Falls back to the standard
    /// oval anchors for round noteheads and any glyph without bespoke metadata.
    pub fn stem_anchors(codepoint: u32) -> StemAnchors {
        match codepoint {
            NOTEHEAD_X_BLACK => StemAnchors {
                up_se: (1.16, -0.444),
                down_nw: (0.0, 0.44),
            },
            NOTEHEAD_X_HALF => StemAnchors {
                up_se: (1.336, -0.412),
                down_nw: (0.0, 0.412),
            },
            NOTEHEAD_CIRCLE_X | NOTEHEAD_CIRCLE_X_HALF => StemAnchors {
                up_se: (0.996, 0.0),
                down_nw: (0.0, 0.0),
            },
            NOTEHEAD_DIAMOND_BLACK => StemAnchors {
                up_se: (1.0, 0.0),
                down_nw: (0.0, 0.0),
            },
            NOTEHEAD_DIAMOND_HALF => StemAnchors {
                up_se: (1.004, 0.0),
                down_nw: (0.0, 0.0),
            },
            NOTEHEAD_TRIANGLE_UP_BLACK => StemAnchors {
                up_se: (1.172, 0.5),
                down_nw: (0.0, 0.5),
            },
            NOTEHEAD_TRIANGLE_UP_HALF => StemAnchors {
                up_se: (1.14, 0.46),
                down_nw: (0.0, 0.46),
            },
            NOTEHEAD_TRIANGLE_DOWN_BLACK => StemAnchors {
                up_se: (1.168, -0.5),
                down_nw: (0.0, -0.5),
            },
            NOTEHEAD_TRIANGLE_DOWN_HALF => StemAnchors {
                up_se: (1.14, -0.464),
                down_nw: (0.0, -0.464),
            },
            NOTEHEAD_SLASH_VERTICAL_BLACK | NOTEHEAD_SLASH_VERTICAL_HALF => StemAnchors {
                up_se: (1.46, -0.656),
                down_nw: (0.0, 0.664),
            },
            _ => STEM_ANCHORS_DEFAULT,
        }
    }

    // ═══════════════════════════════════════
    // Flags (U+E240 - U+E26F)
    // ═══════════════════════════════════════
    pub const FLAG_8TH_UP: u32 = 0xE240;
    pub const FLAG_8TH_DOWN: u32 = 0xE241;
    pub const FLAG_16TH_UP: u32 = 0xE242;
    pub const FLAG_16TH_DOWN: u32 = 0xE243;
    pub const FLAG_32ND_UP: u32 = 0xE244;
    pub const FLAG_32ND_DOWN: u32 = 0xE245;
    pub const FLAG_64TH_UP: u32 = 0xE246;
    pub const FLAG_64TH_DOWN: u32 = 0xE247;
    pub const FLAG_128TH_UP: u32 = 0xE248;
    pub const FLAG_128TH_DOWN: u32 = 0xE249;
    pub const FLAG_256TH_UP: u32 = 0xE24A;
    pub const FLAG_256TH_DOWN: u32 = 0xE24B;
    pub const FLAG_512TH_UP: u32 = 0xE24C;
    pub const FLAG_512TH_DOWN: u32 = 0xE24D;
    pub const FLAG_1024TH_UP: u32 = 0xE24E;
    pub const FLAG_1024TH_DOWN: u32 = 0xE24F;

    /// Stem extension (staff spaces) needed for flagged notes so the stem extends
    /// through the full height of the flag glyph. Values derived from Bravura
    /// glyphsWithAnchors: stemUpNW.y on up-flags, stemDownSW.y on down-flags.
    /// Returns 0.0 if no extension is needed (8th/16th flags are short enough).
    pub fn flag_stem_extension(flag_count: u32, stem_up: bool) -> f64 {
        if stem_up {
            // stemUpNW.y: positive = above flag origin (SMuFL Y-up) → needs extension
            match flag_count {
                1 => 0.0,   // flag8thUp: stemUpNW.y = -0.04 (no extension)
                2 => 0.0,   // flag16thUp: stemUpNW.y = -0.088 (no extension)
                3 => 0.376, // flag32ndUp: stemUpNW.y = 0.376
                4 => 1.172, // flag64thUp: stemUpNW.y = 1.172
                _ => 0.0,
            }
        } else {
            // stemDownSW.y: negative = below flag origin (SMuFL Y-up) → needs extension
            match flag_count {
                1 => 0.0,   // flag8thDown: stemDownSW.y = 0.132 (no extension)
                2 => 0.0,   // flag16thDown: stemDownSW.y = 0.128 (no extension)
                3 => 0.448, // flag32ndDown: stemDownSW.y = -0.448
                4 => 1.244, // flag64thDown: stemDownSW.y = -1.244
                _ => 0.0,
            }
        }
    }

    /// How far (in staff spaces) the flag glyph's body extends back toward the
    /// notehead from the stem tip. Derived from Bravura glyphBBoxes: |bBoxSW.y|
    /// for stem-up flags, bBoxNE.y for stem-down flags. Without lengthening the
    /// stem, an 8th flag at 3.5sp default stem reaches into the notehead body.
    /// Engraving rule: flagged stems must be lengthened
    /// so the flag's curl tip clears the notehead with a small margin.
    pub fn flag_inward_extent(flag_count: u32, stem_up: bool) -> f64 {
        if flag_count == 0 {
            return 0.0;
        }
        if stem_up {
            // |bBoxSW.y| on up-flags
            match flag_count {
                1 => 3.241,
                2 => 3.252,
                3 => 3.248,
                4 => 3.248,
                _ => 3.25,
            }
        } else {
            // bBoxNE.y on down-flags
            match flag_count {
                1 => 3.233,
                2 => 3.248,
                3 => 3.248,
                4 => 3.248,
                _ => 3.25,
            }
        }
    }

    // ═══════════════════════════════════════
    // Rests (U+E4E0 - U+E4FF)
    // ═══════════════════════════════════════
    pub const REST_MAXIMA: u32 = 0xE4E0;
    pub const REST_LONG: u32 = 0xE4E1;
    pub const REST_DOUBLE_WHOLE: u32 = 0xE4E2;
    pub const REST_WHOLE: u32 = 0xE4E3;
    pub const REST_HALF: u32 = 0xE4E4;
    pub const REST_QUARTER: u32 = 0xE4E5;
    pub const REST_8TH: u32 = 0xE4E6;
    pub const REST_16TH: u32 = 0xE4E7;
    pub const REST_32ND: u32 = 0xE4E8;
    pub const REST_64TH: u32 = 0xE4E9;
    pub const REST_128TH: u32 = 0xE4EA;
    pub const REST_256TH: u32 = 0xE4EB;
    pub const REST_512TH: u32 = 0xE4EC;
    pub const REST_1024TH: u32 = 0xE4ED;

    // ═══════════════════════════════════════
    // Repeats — simile marks (U+E500 - U+E50F)
    // ═══════════════════════════════════════
    pub const REPEAT_1_BAR: u32 = 0xE500;
    pub const REPEAT_2_BARS: u32 = 0xE501;
    pub const REPEAT_4_BARS: u32 = 0xE502;

    // ═══════════════════════════════════════
    // Clefs (U+E050 - U+E07F)
    // ═══════════════════════════════════════
    pub const G_CLEF: u32 = 0xE050;
    pub const G_CLEF_15MB: u32 = 0xE051;
    pub const G_CLEF_8VB: u32 = 0xE052;
    pub const G_CLEF_8VA: u32 = 0xE053;
    pub const G_CLEF_15MA: u32 = 0xE054;
    pub const C_CLEF: u32 = 0xE05C;
    pub const C_CLEF_8VB: u32 = 0xE05D;
    pub const F_CLEF: u32 = 0xE062;
    pub const F_CLEF_15MB: u32 = 0xE063;
    pub const F_CLEF_8VB: u32 = 0xE064;
    pub const F_CLEF_8VA: u32 = 0xE065;
    pub const F_CLEF_15MA: u32 = 0xE066;
    pub const UNPITCHED_PERCUSSION_CLEF_1: u32 = 0xE069;
    pub const TAB_CLEF_6STR: u32 = 0xE06D;

    // ═══════════════════════════════════════
    // Accidentals (U+E260 - U+E29F)
    // ═══════════════════════════════════════
    pub const ACCIDENTAL_FLAT: u32 = 0xE260;
    pub const ACCIDENTAL_NATURAL: u32 = 0xE261;
    pub const ACCIDENTAL_SHARP: u32 = 0xE262;
    pub const ACCIDENTAL_DOUBLE_SHARP: u32 = 0xE263;
    pub const ACCIDENTAL_DOUBLE_FLAT: u32 = 0xE264;
    pub const ACCIDENTAL_TRIPLE_SHARP: u32 = 0xE265;
    pub const ACCIDENTAL_TRIPLE_FLAT: u32 = 0xE266;

    // Accidental enclosures (SMuFL standard accidentals range, U+E26A–U+E26D)
    // Reference: accidentalParensLeft/Right, accidentalBracketLeft/Right
    pub const ACCIDENTAL_PARENS_LEFT: u32 = 0xE26A;
    pub const ACCIDENTAL_PARENS_RIGHT: u32 = 0xE26B;
    pub const ACCIDENTAL_BRACKET_LEFT: u32 = 0xE26C;
    pub const ACCIDENTAL_BRACKET_RIGHT: u32 = 0xE26D;

    // ═══════════════════════════════════════
    // Time signatures (U+E080 - U+E09F)
    // ═══════════════════════════════════════
    pub const TIME_SIG_0: u32 = 0xE080;
    pub const TIME_SIG_1: u32 = 0xE081;
    pub const TIME_SIG_2: u32 = 0xE082;
    pub const TIME_SIG_3: u32 = 0xE083;
    pub const TIME_SIG_4: u32 = 0xE084;
    pub const TIME_SIG_5: u32 = 0xE085;
    pub const TIME_SIG_6: u32 = 0xE086;
    pub const TIME_SIG_7: u32 = 0xE087;
    pub const TIME_SIG_8: u32 = 0xE088;
    pub const TIME_SIG_9: u32 = 0xE089;
    pub const TIME_SIG_COMMON: u32 = 0xE08A;
    pub const TIME_SIG_CUT: u32 = 0xE08B;
    pub const TIME_SIG_OPEN_PENDERECKI: u32 = 0xE09C;

    // ═══════════════════════════════════════
    // Time signatures, Bravura stylistic sets (Private Use Area)
    // ═══════════════════════════════════════
    // `ss04 timeSigsLarge` (U+F440–): tall, condensed digits drawn for use
    // outside the staff. They are deliberately about a third the width of the
    // regular digits so a meter scaled to span a whole bracket group stays
    // proportionate instead of becoming enormously wide.
    pub const TIME_SIG_LARGE_0: u32 = 0xF440;
    pub const TIME_SIG_LARGE_9: u32 = 0xF449;
    pub const TIME_SIG_LARGE_COMMON: u32 = 0xF44A;
    pub const TIME_SIG_LARGE_CUT: u32 = 0xF44B;
    pub const TIME_SIG_LARGE_OPEN_PENDERECKI: u32 = 0xF4FE;
    // `ss09 timeSigsLargeNarrow` (U+F506–): moderately condensed digits, for
    // meters that must fit where horizontal room is scarce.
    pub const TIME_SIG_NARROW_0: u32 = 0xF506;
    pub const TIME_SIG_NARROW_9: u32 = 0xF50F;
    pub const TIME_SIG_NARROW_COMMON: u32 = 0xF510;
    pub const TIME_SIG_NARROW_CUT: u32 = 0xF511;
    pub const TIME_SIG_NARROW_OPEN_PENDERECKI: u32 = 0xF523;

    // ═══════════════════════════════════════
    // Articulations (U+E4A0 - U+E4BF)
    // ═══════════════════════════════════════
    pub const ARTIC_ACCENT_ABOVE: u32 = 0xE4A0;
    pub const ARTIC_ACCENT_BELOW: u32 = 0xE4A1;
    pub const ARTIC_STACCATO_ABOVE: u32 = 0xE4A2;
    pub const ARTIC_STACCATO_BELOW: u32 = 0xE4A3;
    pub const ARTIC_TENUTO_ABOVE: u32 = 0xE4A4;
    pub const ARTIC_TENUTO_BELOW: u32 = 0xE4A5;
    pub const ARTIC_STACCATISSIMO_ABOVE: u32 = 0xE4A6;
    pub const ARTIC_STACCATISSIMO_BELOW: u32 = 0xE4A7;
    pub const ARTIC_STACCATISSIMO_WEDGE_ABOVE: u32 = 0xE4A8;
    pub const ARTIC_STACCATISSIMO_WEDGE_BELOW: u32 = 0xE4A9;
    pub const ARTIC_STACCATISSIMO_STROKE_ABOVE: u32 = 0xE4AA;
    pub const ARTIC_STACCATISSIMO_STROKE_BELOW: u32 = 0xE4AB;
    pub const ARTIC_MARCATO_ABOVE: u32 = 0xE4AC;
    pub const ARTIC_MARCATO_BELOW: u32 = 0xE4AD;
    // Combination glyphs (used as ligatures when two articulations are active)
    pub const ARTIC_MARCATO_STACCATO_ABOVE: u32 = 0xE4AE;
    pub const ARTIC_MARCATO_STACCATO_BELOW: u32 = 0xE4AF;
    pub const ARTIC_ACCENT_STACCATO_ABOVE: u32 = 0xE4B0;
    pub const ARTIC_ACCENT_STACCATO_BELOW: u32 = 0xE4B1;
    pub const ARTIC_TENUTO_STACCATO_ABOVE: u32 = 0xE4B2;
    pub const ARTIC_TENUTO_STACCATO_BELOW: u32 = 0xE4B3;
    pub const ARTIC_TENUTO_ACCENT_ABOVE: u32 = 0xE4B4;
    pub const ARTIC_TENUTO_ACCENT_BELOW: u32 = 0xE4B5;
    pub const ARTIC_STRESS_ABOVE: u32 = 0xE4B6;
    pub const ARTIC_STRESS_BELOW: u32 = 0xE4B7;
    pub const ARTIC_UNSTRESS_ABOVE: u32 = 0xE4B8;
    pub const ARTIC_UNSTRESS_BELOW: u32 = 0xE4B9;
    pub const ARTIC_LAISSEZ_VIBRER_ABOVE: u32 = 0xE4BA;
    pub const ARTIC_LAISSEZ_VIBRER_BELOW: u32 = 0xE4BB;
    pub const ARTIC_MARCATO_TENUTO_ABOVE: u32 = 0xE4BC;
    pub const ARTIC_MARCATO_TENUTO_BELOW: u32 = 0xE4BD;
    pub const ARTIC_SOFT_ACCENT_ABOVE: u32 = 0xE4B4; // alias for tenuto-accent
    pub const ARTIC_SOFT_ACCENT_BELOW: u32 = 0xE4B5;

    // ═══════════════════════════════════════
    // String techniques (bow direction) — SMuFL Strings range
    // ═══════════════════════════════════════
    /// Down bow (∏) — MNX `bowDirection.direction = "down"`.
    pub const STRINGS_DOWN_BOW: u32 = 0xE610;
    /// Up bow (V) — MNX `bowDirection.direction = "up"`.
    pub const STRINGS_UP_BOW: u32 = 0xE612;

    // ═══════════════════════════════════════
    // Fermatas (U+E4C0 - U+E4CD)
    // ═══════════════════════════════════════
    pub const FERMATA_ABOVE: u32 = 0xE4C0;
    pub const FERMATA_BELOW: u32 = 0xE4C1;
    /// Very-short fermata (square with dot) — MNX `doubleAngled` symbol.
    pub const FERMATA_VERY_SHORT_ABOVE: u32 = 0xE4C2;
    pub const FERMATA_VERY_SHORT_BELOW: u32 = 0xE4C3;
    /// Short fermata (angled / triangular) — MNX `angled` symbol.
    pub const FERMATA_SHORT_ABOVE: u32 = 0xE4C4;
    pub const FERMATA_SHORT_BELOW: u32 = 0xE4C5;
    /// Long fermata (square / bracket) — MNX `square` symbol.
    pub const FERMATA_LONG_ABOVE: u32 = 0xE4C6;
    pub const FERMATA_LONG_BELOW: u32 = 0xE4C7;
    /// Very-long fermata (rectangular bracket) — MNX `doubleSquare` symbol.
    pub const FERMATA_VERY_LONG_ABOVE: u32 = 0xE4C8;
    pub const FERMATA_VERY_LONG_BELOW: u32 = 0xE4C9;
    /// Long Henze fermata (curve with two dots) — MNX `doubleDot` symbol.
    pub const FERMATA_LONG_HENZE_ABOVE: u32 = 0xE4CA;
    pub const FERMATA_LONG_HENZE_BELOW: u32 = 0xE4CB;
    /// Short Henze fermata (half-curve, no dot) — MNX `halfCurve` symbol.
    pub const FERMATA_SHORT_HENZE_ABOVE: u32 = 0xE4CC;
    pub const FERMATA_SHORT_HENZE_BELOW: u32 = 0xE4CD;
    /// Curlew fermata sign — MNX `curlew` symbol. No `below` pair in SMuFL.
    pub const CURLEW_SIGN: u32 = 0xE4D6;

    // ═══════════════════════════════════════
    // Breath marks (U+E4CE - U+E4D5)
    // ═══════════════════════════════════════
    pub const BREATH_MARK_COMMA: u32 = 0xE4CE;
    pub const BREATH_MARK_TICK: u32 = 0xE4CF;
    pub const BREATH_MARK_UPBOW: u32 = 0xE4D0;
    pub const BREATH_MARK_SALZEDO: u32 = 0xE4D5;

    // ═══════════════════════════════════════
    // Caesuras (U+E4D1 - U+E4D4)
    // ═══════════════════════════════════════
    pub const CAESURA: u32 = 0xE4D1;
    pub const CAESURA_THICK: u32 = 0xE4D2;
    pub const CAESURA_SHORT: u32 = 0xE4D3;
    pub const CAESURA_CURVED: u32 = 0xE4D4;

    // ═══════════════════════════════════════
    // Ornaments (U+E560 - U+E56F)
    // ═══════════════════════════════════════
    pub const ORNAMENT_TRILL: u32 = 0xE566;
    pub const ORNAMENT_TURN: u32 = 0xE567;
    pub const ORNAMENT_TURN_INVERTED: u32 = 0xE568;
    pub const ORNAMENT_DELAYED_TURN: u32 = 0xE569; // Turn with slash
    pub const ORNAMENT_MORDENT: u32 = 0xE56C;
    pub const ORNAMENT_MORDENT_INVERTED: u32 = 0xE56D;
    pub const ORNAMENT_SHORT_TRILL: u32 = 0xE56E;
    pub const ORNAMENT_SCHLEIFER: u32 = 0xE587; // Schleifer (long mordent)
    pub const ORNAMENT_TRILL_MORDENT: u32 = 0xE5BD; // Precomposed trill with mordent

    // ═══════════════════════════════════════
    // Glissando (U+E585 - U+E586)
    // Precomposed glyphs, kept for reference. A wavy glissando is drawn from
    // the multi-segment wiggle below, per the SMuFL multi-segment lines rule.
    // ═══════════════════════════════════════
    pub const GLISSANDO_UP: u32 = 0xE585;
    pub const GLISSANDO_DOWN: u32 = 0xE586;

    // ═══════════════════════════════════════
    // Glissando — multi-segment (U+EAAF)
    // A horizontal wiggle designed to tile: consecutive origins spaced by the
    // glyph's `repeatOffset` join seamlessly. For an angled gliss the segments
    // are rotated by the line's angle and laid along it.
    // ═══════════════════════════════════════
    pub const WIGGLE_GLISSANDO: u32 = 0xEAAF;

    /// Advance width (= repeat offset) of wiggleGlissando in staff spaces.
    /// From Bravura metadata: repeatOffset = [0.96, 0.0].
    pub const WIGGLE_GLISSANDO_SEGMENT_WIDTH: f64 = 0.96;

    /// Ink height of wiggleGlissando above its baseline, in staff spaces.
    /// From Bravura metadata: bBoxSW = [-0.1, 0.0], bBoxNE = [1.124, 0.444].
    /// The wave therefore sits entirely above the origin; centering it on a
    /// connecting line means dropping the origin by half this height.
    pub const WIGGLE_GLISSANDO_HEIGHT: f64 = 0.444;

    // ═══════════════════════════════════════
    // Arpeggios — precomposed (U+E634 - U+E63C)
    // Per SMuFL spec: "Scoring applications should draw arpeggiato markings
    // using multiple instances of the appropriate wiggly line segment glyphs
    // (in the Multi-segment lines range) rather than the precomposed glyphs."
    // Kept for reference only — rendering uses the multi-segment glyphs below.
    // ═══════════════════════════════════════
    pub const ARPEGGIATO_UP: u32 = 0xE634; // Precomposed (DO NOT USE for rendering)
    pub const ARPEGGIATO_DOWN: u32 = 0xE635; // Precomposed (DO NOT USE for rendering)
    pub const ARPEGGIATO: u32 = 0xE63C; // Precomposed (DO NOT USE for rendering)

    // ═══════════════════════════════════════
    // Arpeggios — multi-segment (U+EAA9 - U+EAAE)
    // These are HORIZONTAL glyphs that must be rotated -90° (CCW) to render vertically.
    // Assembly: tile wiggle segments + optional arrow/swash terminal.
    // ═══════════════════════════════════════
    pub const WIGGLE_ARPEGGIATO_UP: u32 = 0xEAA9; // Repeating wiggle segment (upward)
    pub const WIGGLE_ARPEGGIATO_DOWN: u32 = 0xEAAA; // Repeating wiggle segment (downward)
    pub const WIGGLE_ARPEGGIATO_UP_SWASH: u32 = 0xEAAB; // Decorative start for upward
    pub const WIGGLE_ARPEGGIATO_DOWN_SWASH: u32 = 0xEAAC; // Decorative start for downward
    pub const WIGGLE_ARPEGGIATO_UP_ARROW: u32 = 0xEAAD; // Arrow terminal for upward
    pub const WIGGLE_ARPEGGIATO_DOWN_ARROW: u32 = 0xEAAE; // Arrow terminal for downward

    /// Advance width (= repeat offset) of wiggleArpeggiatoUp/Down in staff spaces.
    /// This is the horizontal distance between segment origins (before rotation).
    /// From Bravura metadata: repeatOffset = [1.02, 0.0].
    pub const WIGGLE_ARPEGGIATO_SEGMENT_WIDTH: f64 = 1.02;

    /// Advance width of wiggleArpeggiatoUpArrow/DownArrow in staff spaces.
    /// From Bravura metadata: repeatOffset = [2.064, 0.0].
    pub const WIGGLE_ARPEGGIATO_ARROW_WIDTH: f64 = 2.064;

    /// Advance width of wiggleArpeggiatoUpSwash in staff spaces.
    /// From Bravura metadata: repeatOffset = [2.116, 0.0].
    pub const WIGGLE_ARPEGGIATO_UP_SWASH_WIDTH: f64 = 2.116;

    /// Advance width of wiggleArpeggiatoDownSwash in staff spaces.
    /// From Bravura metadata: repeatOffset = [1.784, 0.0].
    pub const WIGGLE_ARPEGGIATO_DOWN_SWASH_WIDTH: f64 = 1.784;

    // ═══════════════════════════════════════
    // Dynamics (U+E520 - U+E54F)
    // ═══════════════════════════════════════
    pub const DYNAMIC_PIANO: u32 = 0xE520;
    pub const DYNAMIC_MEZZO: u32 = 0xE521;
    pub const DYNAMIC_FORTE: u32 = 0xE522;
    pub const DYNAMIC_RINFORZANDO: u32 = 0xE523;
    pub const DYNAMIC_SFORZANDO: u32 = 0xE524;
    pub const DYNAMIC_Z: u32 = 0xE525;
    pub const DYNAMIC_NIENTE: u32 = 0xE526;
    pub const DYNAMIC_PPPPPP: u32 = 0xE527;
    pub const DYNAMIC_PPPPP: u32 = 0xE528;
    pub const DYNAMIC_PPPP: u32 = 0xE529;
    pub const DYNAMIC_PPP: u32 = 0xE52A;
    pub const DYNAMIC_PP: u32 = 0xE52B;
    pub const DYNAMIC_MP: u32 = 0xE52C;
    pub const DYNAMIC_MF: u32 = 0xE52D;
    pub const DYNAMIC_PF: u32 = 0xE52E;
    pub const DYNAMIC_FF: u32 = 0xE52F;
    pub const DYNAMIC_FFF: u32 = 0xE530;
    pub const DYNAMIC_FFFF: u32 = 0xE531;
    pub const DYNAMIC_FFFFF: u32 = 0xE532;
    pub const DYNAMIC_FFFFFF: u32 = 0xE533;
    pub const DYNAMIC_FORTE_PIANO: u32 = 0xE534;
    pub const DYNAMIC_FORZANDO: u32 = 0xE535;
    pub const DYNAMIC_SFORZANDO1: u32 = 0xE536;
    pub const DYNAMIC_SFORZANDO_PIANO: u32 = 0xE537;
    pub const DYNAMIC_SFORZANDO_PIANISSIMO: u32 = 0xE538;
    pub const DYNAMIC_SFORZATO: u32 = 0xE539;
    pub const DYNAMIC_SFORZATO_PIANO: u32 = 0xE53A;
    pub const DYNAMIC_SFORZATO_FF: u32 = 0xE53B;
    pub const DYNAMIC_RINFORZANDO1: u32 = 0xE53C;
    pub const DYNAMIC_RINFORZANDO2: u32 = 0xE53D;

    // ═══════════════════════════════════════
    // Augmentation dot
    // ═══════════════════════════════════════
    pub const AUGMENTATION_DOT: u32 = 0xE1E7;

    // ═══════════════════════════════════════
    // Metronome note glyphs (U+ECA0 - U+ECB7)
    // Stemmed note glyphs designed for inline use in tempo markings.
    // ═══════════════════════════════════════
    pub const MET_NOTE_DOUBLE_WHOLE: u32 = 0xECA0;
    pub const MET_NOTE_WHOLE: u32 = 0xECA2;
    pub const MET_NOTE_HALF_UP: u32 = 0xECA3;
    pub const MET_NOTE_QUARTER_UP: u32 = 0xECA5;
    pub const MET_NOTE_8TH_UP: u32 = 0xECA7;
    pub const MET_NOTE_16TH_UP: u32 = 0xECA9;
    pub const MET_NOTE_32ND_UP: u32 = 0xECAB;
    pub const MET_NOTE_64TH_UP: u32 = 0xECAD;
    pub const MET_AUGMENTATION_DOT: u32 = 0xECB7;

    // ═══════════════════════════════════════
    // Barlines (U+E030 - U+E04F)
    // ═══════════════════════════════════════
    pub const BARLINE_SINGLE: u32 = 0xE030;
    pub const BARLINE_DOUBLE: u32 = 0xE031;
    pub const BARLINE_FINAL: u32 = 0xE032;
    pub const BARLINE_REVERSE_FINAL: u32 = 0xE033;
    pub const BARLINE_HEAVY: u32 = 0xE034;
    pub const BARLINE_HEAVY_HEAVY: u32 = 0xE035;
    pub const BARLINE_DOTTED: u32 = 0xE037;
    pub const REPEAT_LEFT: u32 = 0xE040;
    pub const REPEAT_RIGHT: u32 = 0xE041;
    pub const REPEAT_RIGHT_LEFT: u32 = 0xE042;
    pub const REPEAT_DOT: u32 = 0xE044;
    pub const SEGNO: u32 = 0xE047;
    pub const CODA: u32 = 0xE048;

    // ═══════════════════════════════════════
    // Tuplet numbers (U+E880 - U+E889)
    // ═══════════════════════════════════════
    pub const TUPLET_0: u32 = 0xE880;
    pub const TUPLET_1: u32 = 0xE881;
    pub const TUPLET_2: u32 = 0xE882;
    pub const TUPLET_3: u32 = 0xE883;
    pub const TUPLET_4: u32 = 0xE884;
    pub const TUPLET_5: u32 = 0xE885;
    pub const TUPLET_6: u32 = 0xE886;
    pub const TUPLET_7: u32 = 0xE887;
    pub const TUPLET_8: u32 = 0xE888;
    pub const TUPLET_9: u32 = 0xE889;
    pub const TUPLET_COLON: u32 = 0xE88A;

    // ═══════════════════════════════════════
    // Octaves / Ottava (U+E510 - U+E51F)
    // ═══════════════════════════════════════
    pub const OTTAVA_ALTA: u32 = 0xE511; // 8va
    pub const QUINDICESIMA_ALTA: u32 = 0xE515; // 15ma
    pub const VENTIDUESIMA_ALTA: u32 = 0xE518; // 22ma
    pub const OTTAVA_BASSA_VB: u32 = 0xE51C; // 8vb
    pub const QUINDICESIMA_BASSA_MB: u32 = 0xE51D; // 15mb
    pub const VENTIDUESIMA_BASSA_MB: u32 = 0xE51E; // 22mb

    // ═══════════════════════════════════════
    // Tremolos (U+E220 - U+E23F)
    // ═══════════════════════════════════════
    pub const TREMOLO_1: u32 = 0xE220; // 1 combining slash (single-note)
    pub const TREMOLO_2: u32 = 0xE221; // 2 combining slashes
    pub const TREMOLO_3: u32 = 0xE222; // 3 combining slashes
    pub const TREMOLO_FINGERED_1: u32 = 0xE225; // 1 slash (multi-note/between stems)
    pub const TREMOLO_FINGERED_2: u32 = 0xE226; // 2 slashes (multi-note)
    pub const TREMOLO_FINGERED_3: u32 = 0xE227; // 3 slashes (multi-note)

    // ═══════════════════════════════════════
    // Keyboard techniques / Pedals (U+E650 - U+E67F)
    // ═══════════════════════════════════════
    pub const KEYBOARD_PEDAL_PED: u32 = 0xE650; // "Ped" text marking
    pub const KEYBOARD_PEDAL_UP: u32 = 0xE655; // "*" asterisk (release)
    pub const KEYBOARD_PEDAL_SOST: u32 = 0xE659; // Sostenuto pedal marking
    pub const KEYBOARD_PEDAL_HALF: u32 = 0xE65A; // Half-pedal marking

    // ═══════════════════════════════════════
    // Fingering (U+ED10 - U+ED15)
    // ═══════════════════════════════════════
    pub const FINGERING_0: u32 = 0xED10;
    pub const FINGERING_1: u32 = 0xED11;
    pub const FINGERING_2: u32 = 0xED12;
    pub const FINGERING_3: u32 = 0xED13;
    pub const FINGERING_4: u32 = 0xED14;
    pub const FINGERING_5: u32 = 0xED15;
    // Chord symbol accidentals (U+ED60 - U+ED6F)
    // ═══════════════════════════════════════
    pub const CHORD_SHARP: u32 = 0xED60;
    pub const CHORD_FLAT: u32 = 0xED62;

    /// Get the chord symbol accidental glyph for a chromatic alteration.
    pub fn chord_accidental_glyph(alter: i32) -> Option<u32> {
        match alter {
            1 => Some(CHORD_SHARP),
            -1 => Some(CHORD_FLAT),
            _ => None,
        }
    }

    /// Get the time signature glyph for a digit 0-9.
    pub fn time_sig_digit(digit: u32) -> u32 {
        TIME_SIG_0 + digit.min(9)
    }

    /// Which cut of the Bravura time-signature digits an engraving style asks
    /// for. The three cuts share a design but differ in width, so the caller
    /// picks the one whose proportions suit the size it draws at.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub enum TimeSigDigits {
        /// Regular digits (U+E080–), for meters set at or near staff size.
        #[default]
        Regular,
        /// `ss04` condensed digits, for meters scaled well beyond staff size.
        Large,
        /// `ss09` moderately condensed digits.
        Narrow,
    }

    impl TimeSigDigits {
        /// Codepoint of a digit 0-9 in this cut.
        pub fn digit(self, digit: u32) -> u32 {
            let base = match self {
                Self::Regular => TIME_SIG_0,
                Self::Large => TIME_SIG_LARGE_0,
                Self::Narrow => TIME_SIG_NARROW_0,
            };
            base + digit.min(9)
        }

        /// Codepoint of the common-time symbol in this cut.
        pub fn common(self) -> u32 {
            match self {
                Self::Regular => TIME_SIG_COMMON,
                Self::Large => TIME_SIG_LARGE_COMMON,
                Self::Narrow => TIME_SIG_NARROW_COMMON,
            }
        }

        /// Codepoint of the cut-time symbol in this cut.
        pub fn cut(self) -> u32 {
            match self {
                Self::Regular => TIME_SIG_CUT,
                Self::Large => TIME_SIG_LARGE_CUT,
                Self::Narrow => TIME_SIG_NARROW_CUT,
            }
        }

        /// Codepoint of the open (senza misura) symbol in this cut.
        pub fn open(self) -> u32 {
            match self {
                Self::Regular => TIME_SIG_OPEN_PENDERECKI,
                Self::Large => TIME_SIG_LARGE_OPEN_PENDERECKI,
                Self::Narrow => TIME_SIG_NARROW_OPEN_PENDERECKI,
            }
        }

        /// Horizontal advance (staff spaces at nominal size) of a digit.
        pub fn digit_advance(self, digit: u32) -> f64 {
            match self {
                Self::Regular => time_sig_digit_advance(digit),
                Self::Large => time_sig_large_digit_advance(digit),
                Self::Narrow => time_sig_narrow_digit_advance(digit),
            }
        }

        /// Horizontal advance (staff spaces at nominal size) of a symbol
        /// glyph in this cut.
        pub fn symbol_advance(self, codepoint: u32) -> f64 {
            match self {
                Self::Regular => 1.69,
                Self::Large => 0.556,
                Self::Narrow => {
                    if codepoint == TIME_SIG_NARROW_OPEN_PENDERECKI {
                        2.036
                    } else {
                        1.008
                    }
                }
            }
        }
    }

    /// Horizontal advance width (in staff spaces) of a time-signature digit
    /// glyph, from Bravura `glyphAdvanceWidths` metadata. Used to kern
    /// multi-digit time signatures and multimeasure-rest counts so adjacent
    /// digits don't collide (a flat advance is too tight for the wider
    /// digits and leaves loose gaps after the narrow `1`).
    pub fn time_sig_digit_advance(digit: u32) -> f64 {
        match digit.min(9) {
            0 => 1.88,
            1 => 1.336,
            2 => 1.784,
            3 => 1.684,
            4 => 1.88,
            5 => 1.612,
            6 => 1.736,
            7 => 1.764,
            8 => 1.744,
            _ => 1.736, // 9
        }
    }

    /// Advance width of an `ss04` (large/condensed) digit, in staff spaces at
    /// nominal size.
    pub fn time_sig_large_digit_advance(digit: u32) -> f64 {
        match digit.min(9) {
            0 => 0.504,
            1 => 0.284,
            2 => 0.528,
            3 => 0.520,
            4 => 0.528,
            5 => 0.512,
            6 => 0.512,
            7 => 0.512,
            8 => 0.520,
            _ => 0.512, // 9
        }
    }

    /// Advance width of an `ss09` (narrow) digit, in staff spaces at nominal
    /// size.
    pub fn time_sig_narrow_digit_advance(digit: u32) -> f64 {
        match digit.min(9) {
            0 => 1.032,
            1 => 0.708,
            2 => 0.976,
            3 => 0.916,
            4 => 1.032,
            5 => 0.876,
            6 => 0.948,
            7 => 0.968,
            8 => 0.960,
            _ => 0.948, // 9
        }
    }

    /// Get the flag glyph for a given flag count and stem direction.
    /// SMuFL provides flags from 8th (count 1) through 1024th (count 8).
    /// Counts above 8 (2048th, 4096th) have no SMuFL glyph and return None;
    /// renderers should fall back to extra beam levels at the layout layer.
    pub fn flag_glyph(flag_count: u32, stem_up: bool) -> Option<u32> {
        match (flag_count, stem_up) {
            (1, true) => Some(FLAG_8TH_UP),
            (1, false) => Some(FLAG_8TH_DOWN),
            (2, true) => Some(FLAG_16TH_UP),
            (2, false) => Some(FLAG_16TH_DOWN),
            (3, true) => Some(FLAG_32ND_UP),
            (3, false) => Some(FLAG_32ND_DOWN),
            (4, true) => Some(FLAG_64TH_UP),
            (4, false) => Some(FLAG_64TH_DOWN),
            (5, true) => Some(FLAG_128TH_UP),
            (5, false) => Some(FLAG_128TH_DOWN),
            (6, true) => Some(FLAG_256TH_UP),
            (6, false) => Some(FLAG_256TH_DOWN),
            (7, true) => Some(FLAG_512TH_UP),
            (7, false) => Some(FLAG_512TH_DOWN),
            (8, true) => Some(FLAG_1024TH_UP),
            (8, false) => Some(FLAG_1024TH_DOWN),
            _ => None,
        }
    }

    /// Get the notehead glyph for a duration base.
    /// `DuplexMaxima`, `Maxima`, `Longa`, `Breve` all share the double-whole
    /// notehead (standard CMN practice — there is no separate maxima/longa
    /// notehead glyph in the mainstream SMuFL ranges; these durations are
    /// disambiguated by their surrounding bars at the layout layer).
    pub fn notehead_glyph(duration: &crate::model::NoteValueBase) -> u32 {
        use crate::model::NoteValueBase::*;
        match duration {
            DuplexMaxima | Maxima | Longa | Breve => NOTEHEAD_DOUBLE_WHOLE,
            Whole => NOTEHEAD_WHOLE,
            Half => NOTEHEAD_HALF,
            _ => NOTEHEAD_BLACK,
        }
    }

    /// Get the percussion / shape notehead glyph for a kit-component shape and duration.
    /// Falls back to the standard notehead_glyph when shape is None or Normal.
    pub fn percussion_notehead_glyph(
        shape: Option<&crate::model::kit::NoteheadShape>,
        duration: &crate::model::NoteValueBase,
    ) -> u32 {
        use crate::model::kit::NoteheadShape;
        use crate::model::NoteValueBase::*;
        let Some(shape) = shape else {
            return notehead_glyph(duration);
        };
        let is_double_whole = matches!(duration, Breve | Longa | Maxima | DuplexMaxima);
        let is_whole = matches!(duration, Whole);
        let is_half = matches!(duration, Half);
        match shape {
            NoteheadShape::Normal => notehead_glyph(duration),
            NoteheadShape::X => {
                if is_double_whole {
                    NOTEHEAD_X_DOUBLE_WHOLE
                } else if is_whole {
                    NOTEHEAD_X_WHOLE
                } else if is_half {
                    NOTEHEAD_X_HALF
                } else {
                    NOTEHEAD_X_BLACK
                }
            }
            NoteheadShape::Diamond => {
                if is_double_whole {
                    NOTEHEAD_DIAMOND_DOUBLE_WHOLE
                } else if is_whole {
                    NOTEHEAD_DIAMOND_WHOLE
                } else if is_half {
                    NOTEHEAD_DIAMOND_HALF
                } else {
                    NOTEHEAD_DIAMOND_BLACK
                }
            }
            NoteheadShape::CircleX => {
                if is_double_whole {
                    NOTEHEAD_CIRCLE_X_DOUBLE_WHOLE
                } else if is_whole {
                    NOTEHEAD_CIRCLE_X_WHOLE
                } else if is_half {
                    NOTEHEAD_CIRCLE_X_HALF
                } else {
                    NOTEHEAD_CIRCLE_X
                }
            }
            NoteheadShape::Slash => {
                if is_double_whole {
                    NOTEHEAD_SLASH_VERTICAL_DOUBLE_WHOLE
                } else if is_whole {
                    NOTEHEAD_SLASH_VERTICAL_WHOLE
                } else if is_half {
                    NOTEHEAD_SLASH_VERTICAL_HALF
                } else {
                    NOTEHEAD_SLASH_VERTICAL_BLACK
                }
            }
            NoteheadShape::TriangleUp => {
                if is_double_whole {
                    NOTEHEAD_TRIANGLE_UP_DOUBLE_WHOLE
                } else if is_whole {
                    NOTEHEAD_TRIANGLE_UP_WHOLE
                } else if is_half {
                    NOTEHEAD_TRIANGLE_UP_HALF
                } else {
                    NOTEHEAD_TRIANGLE_UP_BLACK
                }
            }
            NoteheadShape::TriangleDown => {
                if is_double_whole {
                    NOTEHEAD_TRIANGLE_DOWN_DOUBLE_WHOLE
                } else if is_whole {
                    NOTEHEAD_TRIANGLE_DOWN_WHOLE
                } else if is_half {
                    NOTEHEAD_TRIANGLE_DOWN_HALF
                } else {
                    NOTEHEAD_TRIANGLE_DOWN_BLACK
                }
            }
        }
    }

    /// Get the notehead body width in staff spaces for a given notehead codepoint.
    /// Uses SMuFL bounding box data. For double-whole notes, returns the body
    /// width excluding the origin offset (the visible notehead extent used for
    /// ledger line centering).
    pub fn notehead_width(codepoint: u32) -> f64 {
        let (bx, _, bw, _) = glyph_bbox(codepoint);
        // For double-whole, the bbox x_min is negative (-0.18). The body width
        // that ledger lines should span is from x_min to x_min + width, relative
        // to the glyph's draw origin offset by NOTEHEAD_DOUBLE_WHOLE_ORIGIN.
        // Effectively: bw covers the full glyph including brackets.
        if codepoint == NOTEHEAD_DOUBLE_WHOLE {
            // The glyph is drawn at note_x - ORIGIN.0, so the visible extent from
            // note_x is: (bx + ORIGIN.0) to (bx + bw + ORIGIN.0) → width = bw
            bw
        } else {
            bw - bx // For standard noteheads bx=0, so this is just bw
        }
    }

    /// Rightmost notehead ink relative to the rhythmic origin, in staff spaces.
    pub fn notehead_right_extent(codepoint: u32) -> f64 {
        let (bbox_x, _, bbox_width, _) = glyph_bbox(codepoint);
        let draw_origin = if codepoint == NOTEHEAD_DOUBLE_WHOLE {
            -NOTEHEAD_DOUBLE_WHOLE_ORIGIN.0
        } else {
            0.0
        };
        draw_origin + bbox_x + bbox_width
    }

    /// Get the metronome-mark note glyph for a tempo's beat-unit note value.
    /// These are the stemmed `metNote*` glyphs (U+ECA0–U+ECAD) designed for
    /// inline use in tempo markings (e.g. "♩ = 120"). Durations smaller than a
    /// 64th note fall back to the 64th-note glyph.
    pub fn metronome_note_glyph(base: &crate::model::NoteValueBase) -> u32 {
        use crate::model::NoteValueBase::*;
        match base {
            DuplexMaxima | Maxima | Longa | Breve => MET_NOTE_DOUBLE_WHOLE,
            Whole => MET_NOTE_WHOLE,
            Half => MET_NOTE_HALF_UP,
            Quarter => MET_NOTE_QUARTER_UP,
            Eighth => MET_NOTE_8TH_UP,
            Sixteenth => MET_NOTE_16TH_UP,
            ThirtySecond => MET_NOTE_32ND_UP,
            _ => MET_NOTE_64TH_UP,
        }
    }

    /// Horizontal advance width (in staff spaces) of a metronome-mark glyph,
    /// from Bravura font metadata. Used to flow the "= bpm" text after the
    /// note glyph in tempo markings. Unknown glyphs fall back to 1.3sp.
    pub fn metronome_glyph_advance(codepoint: u32) -> f64 {
        match codepoint {
            MET_NOTE_DOUBLE_WHOLE => 2.62,
            MET_NOTE_WHOLE => 1.836,
            MET_NOTE_HALF_UP => 1.364,
            MET_NOTE_QUARTER_UP => 1.328,
            MET_NOTE_8TH_UP => 2.136,
            MET_NOTE_16TH_UP => 2.088,
            MET_NOTE_32ND_UP => 2.152,
            MET_NOTE_64TH_UP => 2.148,
            MET_AUGMENTATION_DOT => 0.4,
            _ => 1.3,
        }
    }

    /// Approximate advance width of a single character in the default bold
    /// serif text face, expressed as a fraction of the font's em (point) size.
    ///
    /// The layout engine has no real font loaded on the WASM/canvas path, so it
    /// can't call into a font rasterizer to measure text. These values are the
    /// Times-Bold AFM advance widths (per-1000 em, divided to a 0–1 fraction),
    /// which closely match the "serif bold" face browsers use (Times New Roman
    /// Bold on Windows, Liberation/DejaVu Serif Bold elsewhere). They let the
    /// engine flow inline glyphs (e.g. the metronome note in a tempo marking)
    /// directly after proportional text without the gap a flat per-character
    /// estimate produces. Unknown characters fall back to a 0.5 em average.
    pub fn serif_bold_char_advance(ch: char) -> f64 {
        let units: u32 = match ch {
            ' ' => 250,
            '!' => 333,
            '"' => 555,
            '#' => 500,
            '$' => 500,
            '%' => 1000,
            '&' => 833,
            '\'' => 278,
            '(' | ')' => 333,
            '*' => 500,
            '+' | '<' | '=' | '>' => 570,
            ',' | '.' => 250,
            '-' => 333,
            '/' => 278,
            '0'..='9' => 500,
            ':' | ';' => 333,
            '?' => 500,
            '@' => 832,
            'A' => 722,
            'B' => 667,
            'C' => 722,
            'D' => 722,
            'E' => 667,
            'F' => 611,
            'G' => 778,
            'H' => 778,
            'I' => 389,
            'J' => 500,
            'K' => 778,
            'L' => 667,
            'M' => 944,
            'N' => 722,
            'O' => 778,
            'P' => 611,
            'Q' => 778,
            'R' => 722,
            'S' => 556,
            'T' => 667,
            'U' => 722,
            'V' => 722,
            'W' => 1000,
            'X' => 722,
            'Y' => 722,
            'Z' => 667,
            '[' | ']' => 333,
            '\\' => 278,
            '^' => 581,
            '_' => 500,
            '`' => 333,
            'a' => 500,
            'b' => 556,
            'c' => 444,
            'd' => 556,
            'e' => 444,
            'f' => 333,
            'g' => 500,
            'h' => 556,
            'i' => 278,
            'j' => 333,
            'k' => 556,
            'l' => 278,
            'm' => 833,
            'n' => 556,
            'o' => 500,
            'p' => 556,
            'q' => 556,
            'r' => 444,
            's' => 389,
            't' => 333,
            'u' => 556,
            'v' => 500,
            'w' => 722,
            'x' => 500,
            'y' => 500,
            'z' => 444,
            '{' | '}' => 394,
            '|' => 220,
            '~' => 520,
            _ => 500,
        };
        units as f64 / 1000.0
    }

    /// Total advance width of a string in the default bold serif text face, in
    /// the same units as `size` (see `serif_bold_char_advance`).
    pub fn serif_bold_text_width(text: &str, size: f64) -> f64 {
        text.chars().map(serif_bold_char_advance).sum::<f64>() * size
    }

    /// `2048th` and `4096th` have no SMuFL rest glyph; they fall back to the
    /// `1024th` rest (renderers must add extra slashes at the layout layer).
    pub fn rest_glyph(duration: &crate::model::NoteValueBase) -> u32 {
        use crate::model::NoteValueBase::*;
        match duration {
            DuplexMaxima => REST_MAXIMA,
            Maxima => REST_MAXIMA,
            Longa => REST_LONG,
            Breve => REST_DOUBLE_WHOLE,
            Whole => REST_WHOLE,
            Half => REST_HALF,
            Quarter => REST_QUARTER,
            Eighth => REST_8TH,
            Sixteenth => REST_16TH,
            ThirtySecond => REST_32ND,
            SixtyFourth => REST_64TH,
            HundredTwentyEighth => REST_128TH,
            TwoHundredFiftySixth => REST_256TH,
            FiveHundredTwelfth => REST_512TH,
            ThousandTwentyFourth => REST_1024TH,
            TwoThousandFortyEighth | FourThousandNinetySixth => REST_1024TH,
        }
    }

    /// Get the tuplet number glyph for a digit 0-9.
    pub fn tuplet_digit(digit: u32) -> u32 {
        TUPLET_0 + digit.min(9)
    }

    /// Get the accidental glyph for a chromatic alteration.
    pub fn accidental_glyph(alter: i32) -> Option<u32> {
        match alter {
            -3 => Some(ACCIDENTAL_TRIPLE_FLAT),
            -2 => Some(ACCIDENTAL_DOUBLE_FLAT),
            -1 => Some(ACCIDENTAL_FLAT),
            0 => Some(ACCIDENTAL_NATURAL),
            1 => Some(ACCIDENTAL_SHARP),
            2 => Some(ACCIDENTAL_DOUBLE_SHARP),
            3 => Some(ACCIDENTAL_TRIPLE_SHARP),
            _ => None,
        }
    }

    /// Get the dynamics glyph codepoint for a dynamic value string.
    /// Returns a pre-composed glyph for known combinations (e.g., "sfz" → U+E539).
    pub fn dynamics_glyph(value: &str) -> Option<u32> {
        match value {
            "pppppp" => Some(DYNAMIC_PPPPPP),
            "ppppp" => Some(DYNAMIC_PPPPP),
            "pppp" => Some(DYNAMIC_PPPP),
            "ppp" => Some(DYNAMIC_PPP),
            "pp" => Some(DYNAMIC_PP),
            "p" => Some(DYNAMIC_PIANO),
            "mp" => Some(DYNAMIC_MP),
            "mf" => Some(DYNAMIC_MF),
            "pf" => Some(DYNAMIC_PF),
            "f" => Some(DYNAMIC_FORTE),
            "ff" => Some(DYNAMIC_FF),
            "fff" => Some(DYNAMIC_FFF),
            "ffff" => Some(DYNAMIC_FFFF),
            "fffff" => Some(DYNAMIC_FFFFF),
            "ffffff" => Some(DYNAMIC_FFFFFF),
            "fp" => Some(DYNAMIC_FORTE_PIANO),
            "fz" => Some(DYNAMIC_FORZANDO),
            "sf" => Some(DYNAMIC_SFORZANDO1),
            "sfp" => Some(DYNAMIC_SFORZANDO_PIANO),
            "sfpp" => Some(DYNAMIC_SFORZANDO_PIANISSIMO),
            "sfz" => Some(DYNAMIC_SFORZATO),
            "sfzp" => Some(DYNAMIC_SFORZATO_PIANO),
            "sffz" => Some(DYNAMIC_SFORZATO_FF),
            "rf" => Some(DYNAMIC_RINFORZANDO1),
            "rfz" => Some(DYNAMIC_RINFORZANDO2),
            "n" => Some(DYNAMIC_NIENTE),
            _ => None,
        }
    }

    /// Map a single dynamic letter to its SMuFL codepoint.
    /// p=U+E520, m=U+E521, f=U+E522, r=U+E523, s=U+E524, z=U+E525, n=U+E526
    ///
    /// Per SMuFL implementation notes: "Scoring applications may choose to draw
    /// dynamics either using multiple glyphs (e.g. 3 × dynamicForte for fff) or
    /// using the pre-composed glyph (e.g. 1 × dynamicFFF)."
    pub fn dynamics_letter_glyph(ch: char) -> Option<u32> {
        match ch {
            'p' => Some(DYNAMIC_PIANO),
            'm' => Some(DYNAMIC_MEZZO),
            'f' => Some(DYNAMIC_FORTE),
            'r' => Some(DYNAMIC_RINFORZANDO),
            's' => Some(DYNAMIC_SFORZANDO),
            'z' => Some(DYNAMIC_Z),
            'n' => Some(DYNAMIC_NIENTE),
            _ => None,
        }
    }

    /// Check if a dynamic value string consists entirely of valid dynamic letters.
    pub fn is_valid_dynamic_letters(value: &str) -> bool {
        !value.is_empty() && value.chars().all(|ch| dynamics_letter_glyph(ch).is_some())
    }

    /// Advance width of a single dynamic letter glyph in staff spaces
    /// (from Bravura glyphAdvanceWidths metadata).
    pub fn dynamics_letter_width(ch: char) -> f64 {
        match ch {
            'p' => 1.46,
            'm' => 1.748,
            'f' => 1.456,
            'r' => 1.108,
            's' => 0.916,
            'z' => 0.976,
            'n' => 1.232,
            _ => 1.0,
        }
    }

    /// Kerning adjustment between two adjacent dynamic letter glyphs in staff spaces.
    /// Derived from comparing pre-composed glyph widths to summed individual letter widths.
    /// Returns a negative value to tighten spacing (e.g. f+f, f+z where the swoosh overlaps).
    pub fn dynamics_kern_pair(left: char, right: char) -> f64 {
        match (left, right) {
            ('f', 'f') => -0.476, // ff: 2.436 vs f+f=2.912
            ('f', 'z') => -0.444, // fz: 1.988 vs f+z=2.432
            ('f', 'p') => -0.440, // fp: 2.476 vs f+p=2.916
            ('r', 'f') => -0.064, // rf: 2.500 vs r+f=2.564
            ('m', 'f') => -0.016, // mf: 3.188 vs m+f=3.204
            _ => 0.0,
        }
    }

    /// Advance width of a dynamics glyph in staff spaces (from Bravura metadata).
    /// For known pre-composed glyphs, returns the exact width. For custom letter
    /// combinations, sums individual letter widths with kerning adjustments.
    pub fn dynamics_glyph_width(value: &str) -> f64 {
        match value {
            "pppppp" => 8.496,
            "ppppp" => 7.104,
            "pppp" => 5.668,
            "ppp" => 4.288,
            "pp" => 2.908,
            "p" => 1.46,
            "mp" => 3.304,
            "mf" => 3.188,
            "pf" => 3.08,
            "f" => 1.456,
            "ff" => 2.436,
            "fff" => 3.324,
            "ffff" => 4.28,
            "fffff" => 5.24,
            "ffffff" => 6.2,
            "fp" => 2.476,
            "fz" => 1.988,
            "sf" => 2.416,
            "sfp" => 3.384,
            "sfpp" => 4.792,
            "sfz" => 2.928,
            "sfzp" => 4.3,
            "sffz" => 3.856,
            "rf" => 2.5,
            "rfz" => 2.976,
            "n" => 1.232,
            _ => {
                // Custom dynamics: sum individual letter widths with kerning
                if is_valid_dynamic_letters(value) {
                    let chars: Vec<char> = value.chars().collect();
                    let mut w: f64 = chars.iter().map(|&ch| dynamics_letter_width(ch)).sum();
                    for pair in chars.windows(2) {
                        w += dynamics_kern_pair(pair[0], pair[1]);
                    }
                    w
                } else {
                    2.0
                }
            }
        }
    }

    /// Visual center X of a dynamics glyph in staff spaces.
    /// Computed from the glyph bounding box as `bbox_left + bbox_width / 2`.
    /// For custom letter dynamics, falls back to advance_width / 2.
    pub fn dynamics_optical_center(value: &str) -> f64 {
        // For pre-composed dynamics, compute center from the visual bounding box
        if let Some(cp) = dynamics_glyph(value) {
            let (bx, _by, bw, _bh) = glyph_bbox(cp);
            return bx + bw / 2.0;
        }
        // For custom letter combinations, fall back to advance width / 2
        dynamics_glyph_width(value) / 2.0
    }

    /// Width of an accidental glyph in staff spaces (from Bravura bounding boxes).
    pub fn accidental_width(alter: i32) -> f64 {
        match alter {
            -3 => 2.400, // triple flat (from Bravura glyphAdvanceWidths)
            -2 => 1.644, // double flat
            -1 => 0.904, // flat
            0 => 0.672,  // natural
            1 => 0.996,  // sharp
            2 => 0.988,  // double sharp
            3 => 2.052,  // triple sharp (from Bravura glyphAdvanceWidths)
            _ => 1.0,    // fallback
        }
    }

    /// Width of an accidental enclosure glyph in staff spaces (from Bravura bounding boxes).
    /// Parentheses: 0.564sp, Brackets: 0.308sp.
    pub fn accidental_enclosure_width(is_parentheses: bool) -> f64 {
        if is_parentheses {
            0.564
        } else {
            0.308
        }
    }

    /// Vertical extent of an accidental glyph in half-spaces from the note center.
    /// Returns (above, below) where above = half-spaces extending upward,
    /// below = half-spaces extending downward. From Bravura bounding boxes.
    pub fn accidental_vertical_extent(alter: i32) -> (f64, f64) {
        match alter {
            -3 => (3.5, 1.4), // triple flat: three flat lobes (from Bravura bBoxNE/SW)
            -2 => (3.0, 1.0), // double flat: tall upper lobe
            -1 => (3.0, 1.0), // flat: tall upper lobe, short below
            0 => (2.4, 2.4),  // natural: nearly symmetric
            1 => (2.8, 2.8),  // sharp: symmetric, tall
            2 => (0.6, 0.6),  // double sharp: compact
            3 => (2.8, 2.8),  // triple sharp: three sharp signs (from Bravura bBoxNE/SW)
            _ => (2.8, 2.8),  // fallback
        }
    }

    /// Bounding box cut-outs for accidentals in staff spaces (from Bravura glyphsWithAnchors).
    ///
    /// Cut-outs define rectangular concave regions at the corners of a glyph's bounding box
    /// where another glyph may intrude without visual collision. This enables tighter kerning
    /// when stacking accidental columns in chords.
    ///
    /// Returns `AccidentalCutOuts` with optional cut-out dimensions for each corner.
    /// Each cut-out is `(width, height)` in staff spaces measured inward from the bbox corner.
    pub fn accidental_cut_outs(alter: i32) -> AccidentalCutOuts {
        match alter {
            // Flat: cut-outs on right side (NE = upper stem area, SE = lower right)
            -1 => AccidentalCutOuts {
                ne: Some((0.252, 0.656)), // cutOutNE [x, y] from Bravura
                se: Some((0.504, 0.476)), // cutOutSE [x, abs(y)]
                ..Default::default()
            },
            // Natural: NE (upper right) and SW (lower left)
            0 => AccidentalCutOuts {
                ne: Some((0.192, 0.776)),
                sw: Some((0.476, 0.828)),
                ..Default::default()
            },
            // Sharp: all four corners
            1 => AccidentalCutOuts {
                ne: Some((0.84, 0.896)),
                nw: Some((0.144, 0.568)),
                se: Some((0.84, 0.596)),
                sw: Some((0.144, 0.896)),
            },
            // Double flat: NE and SE (right side only, like flat)
            -2 => AccidentalCutOuts {
                ne: Some((0.988, 0.644)),
                se: Some((1.336, 0.396)),
                ..Default::default()
            },
            // Double sharp: no cut-outs (compact symmetric glyph)
            _ => AccidentalCutOuts::default(),
        }
    }

    /// Cut-out regions at the four corners of an accidental's bounding box.
    /// Each cut-out is `(width_inward, height_inward)` in staff spaces.
    #[derive(Debug, Clone, Default)]
    pub struct AccidentalCutOuts {
        /// Top-right corner cut-out: `(width, height)` measured left and down from NE corner.
        pub ne: Option<(f64, f64)>,
        /// Bottom-right corner cut-out: `(width, height)` measured left and up from SE corner.
        pub se: Option<(f64, f64)>,
        /// Top-left corner cut-out: `(width, height)` measured right and down from NW corner.
        pub nw: Option<(f64, f64)>,
        /// Bottom-left corner cut-out: `(width, height)` measured right and up from SW corner.
        pub sw: Option<(f64, f64)>,
    }

    /// Get the ottava glyph codepoint and width (in staff spaces) for a given ottava value.
    /// Returns (codepoint, width_in_staff_spaces).
    pub fn ottava_glyph(value: i32) -> (u32, f64) {
        match value {
            1 => (OTTAVA_ALTA, 3.54),
            2 => (QUINDICESIMA_ALTA, 5.26),
            3 => (VENTIDUESIMA_ALTA, 5.712),
            -1 => (OTTAVA_BASSA_VB, 3.184),
            -2 => (QUINDICESIMA_BASSA_MB, 4.924),
            -3 => (VENTIDUESIMA_BASSA_MB, 5.34),
            _ => (OTTAVA_ALTA, 3.54),
        }
    }

    /// Width of an articulation glyph in staff spaces (from Bravura bounding boxes).
    /// Used to horizontally center articulations on noteheads.
    pub fn articulation_width(codepoint: u32) -> f64 {
        match codepoint {
            ARTIC_ACCENT_ABOVE | ARTIC_ACCENT_BELOW => 1.356,
            ARTIC_STACCATO_ABOVE | ARTIC_STACCATO_BELOW => 0.336,
            ARTIC_STACCATISSIMO_ABOVE | ARTIC_STACCATISSIMO_BELOW => 0.396,
            ARTIC_TENUTO_ABOVE | ARTIC_TENUTO_BELOW => 1.356,
            ARTIC_STACCATISSIMO_WEDGE_ABOVE | ARTIC_STACCATISSIMO_WEDGE_BELOW => 0.356,
            ARTIC_STACCATISSIMO_STROKE_ABOVE | ARTIC_STACCATISSIMO_STROKE_BELOW => 0.192,
            ARTIC_MARCATO_ABOVE | ARTIC_MARCATO_BELOW => 0.944,
            // Combination ligature widths (from Bravura metadata)
            ARTIC_MARCATO_STACCATO_ABOVE | ARTIC_MARCATO_STACCATO_BELOW => 0.944,
            ARTIC_ACCENT_STACCATO_ABOVE | ARTIC_ACCENT_STACCATO_BELOW => 1.356,
            ARTIC_TENUTO_STACCATO_ABOVE | ARTIC_TENUTO_STACCATO_BELOW => 1.356,
            ARTIC_TENUTO_ACCENT_ABOVE | ARTIC_TENUTO_ACCENT_BELOW => 1.356,
            ARTIC_MARCATO_TENUTO_ABOVE | ARTIC_MARCATO_TENUTO_BELOW => 1.352,
            ARTIC_STRESS_ABOVE | ARTIC_STRESS_BELOW => 0.94,
            ARTIC_UNSTRESS_ABOVE | ARTIC_UNSTRESS_BELOW => 1.528,
            ARTIC_LAISSEZ_VIBRER_ABOVE | ARTIC_LAISSEZ_VIBRER_BELOW => 1.468,
            _ => 1.0, // fallback
        }
    }

    /// Get the SMuFL tremolo glyph for a given number of marks (1–3) on a single note.
    pub fn tremolo_glyph(marks: u32) -> Option<u32> {
        match marks {
            1 => Some(TREMOLO_1),
            2 => Some(TREMOLO_2),
            3 => Some(TREMOLO_3),
            _ => None,
        }
    }

    /// Get the SMuFL fingered tremolo glyph for multi-note tremolos (1–3 marks between stems).
    pub fn tremolo_fingered_glyph(marks: u32) -> Option<u32> {
        match marks {
            1 => Some(TREMOLO_FINGERED_1),
            2 => Some(TREMOLO_FINGERED_2),
            3 => Some(TREMOLO_FINGERED_3),
            _ => None,
        }
    }

    /// Get the SMuFL fingering glyph for a finger number (0–5).
    pub fn fingering_glyph(finger: u32) -> Option<u32> {
        match finger {
            0 => Some(FINGERING_0),
            1 => Some(FINGERING_1),
            2 => Some(FINGERING_2),
            3 => Some(FINGERING_3),
            4 => Some(FINGERING_4),
            5 => Some(FINGERING_5),
            _ => None,
        }
    }

    /// Get the SMuFL breath mark glyph for a given symbol type.
    pub fn breath_mark_glyph(symbol: &Option<crate::model::BreathMarkSymbol>) -> u32 {
        use crate::model::BreathMarkSymbol;
        match symbol {
            Some(BreathMarkSymbol::Tick) => BREATH_MARK_TICK,
            Some(BreathMarkSymbol::Upbow) => BREATH_MARK_UPBOW,
            Some(BreathMarkSymbol::Salzedo) => BREATH_MARK_SALZEDO,
            Some(BreathMarkSymbol::Comma | BreathMarkSymbol::Auto) | None => BREATH_MARK_COMMA,
        }
    }

    /// Get the SMuFL caesura glyph for a given style.
    pub fn caesura_glyph(style: &Option<crate::model::CaesuraStyle>) -> u32 {
        use crate::model::CaesuraStyle;
        match style {
            Some(CaesuraStyle::Thick) => CAESURA_THICK,
            Some(CaesuraStyle::Short) => CAESURA_SHORT,
            Some(CaesuraStyle::Curved) => CAESURA_CURVED,
            Some(CaesuraStyle::Normal) | None => CAESURA,
        }
    }

    /// Get the (above, below) fermata glyph pair for a given symbol.
    ///
    /// Mapping per MNX spec (https://w3c-cg.github.io/mnx/docs/mnx-reference/objects/fermata-symbol/):
    /// - `normal`       → fermataAbove (E4C0)              / fermataBelow (E4C1)
    /// - `angled`       → fermataShortAbove (E4C4)         / fermataShortBelow (E4C5)
    /// - `square`       → fermataLongAbove (E4C6)          / fermataLongBelow (E4C7)
    /// - `doubleAngled` → fermataVeryShortAbove (E4C2)     / fermataVeryShortBelow (E4C3)
    /// - `doubleSquare` → fermataVeryLongAbove (E4C8)      / fermataVeryLongBelow (E4C9)
    /// - `doubleDot`    → fermataLongHenzeAbove (E4CA)     / fermataLongHenzeBelow (E4CB)
    /// - `halfCurve`    → fermataShortHenzeAbove (E4CC)    / fermataShortHenzeBelow (E4CD)
    /// - `curlew`       → curlewSign (E4D6) — no below pair in SMuFL; we re-use the same glyph.
    pub fn fermata_glyph(symbol: &crate::model::FermataSymbol) -> (u32, u32) {
        use crate::model::FermataSymbol;
        match symbol {
            FermataSymbol::Normal => (FERMATA_ABOVE, FERMATA_BELOW),
            FermataSymbol::Angled => (FERMATA_SHORT_ABOVE, FERMATA_SHORT_BELOW),
            FermataSymbol::Square => (FERMATA_LONG_ABOVE, FERMATA_LONG_BELOW),
            FermataSymbol::DoubleAngled => (FERMATA_VERY_SHORT_ABOVE, FERMATA_VERY_SHORT_BELOW),
            FermataSymbol::DoubleSquare => (FERMATA_VERY_LONG_ABOVE, FERMATA_VERY_LONG_BELOW),
            FermataSymbol::DoubleDot => (FERMATA_LONG_HENZE_ABOVE, FERMATA_LONG_HENZE_BELOW),
            FermataSymbol::HalfCurve => (FERMATA_SHORT_HENZE_ABOVE, FERMATA_SHORT_HENZE_BELOW),
            // SMuFL has no inverted curlew; re-use the upright glyph for both orientations.
            FermataSymbol::Curlew => (CURLEW_SIGN, CURLEW_SIGN),
        }
    }

    /// Get the SMuFL trill glyph, optionally with accidental variant.
    pub fn trill_glyph(_accidental: &Option<i32>) -> u32 {
        ORNAMENT_TRILL
    }

    /// Get the SMuFL ornament glyph for a given ornament type.
    pub fn ornament_glyph(ornament: &crate::model::OrnamentType) -> u32 {
        use crate::model::OrnamentType;
        match ornament {
            OrnamentType::Turn => ORNAMENT_TURN,
            OrnamentType::InvertedTurn => ORNAMENT_TURN_INVERTED,
            OrnamentType::Mordent => ORNAMENT_MORDENT,
            OrnamentType::InvertedMordent => ORNAMENT_MORDENT_INVERTED,
            OrnamentType::ShortTrill => ORNAMENT_SHORT_TRILL,
            OrnamentType::TrillMordent => ORNAMENT_TRILL_MORDENT,
            OrnamentType::DelayedTurn => ORNAMENT_DELAYED_TURN,
            OrnamentType::Schleifer => ORNAMENT_SCHLEIFER,
        }
    }

    /// Get the multi-segment arpeggio glyphs for a given direction.
    ///
    /// Returns (segment_codepoint, segment_width, arrow_codepoint, arrow_width)
    /// where arrow is `Option` (None for plain arpeggio without arrow).
    ///
    /// All glyphs are horizontal and must be rotated -90° (CCW) for vertical rendering.
    /// Widths are in staff spaces at font_size = 4*sp.
    pub fn arpeggio_glyphs(direction: &Option<crate::model::ArpeggioDirection>) -> ArpeggioGlyphs {
        use crate::model::ArpeggioDirection;
        match direction {
            Some(ArpeggioDirection::Up) => ArpeggioGlyphs {
                segment: WIGGLE_ARPEGGIATO_UP,
                segment_width: WIGGLE_ARPEGGIATO_SEGMENT_WIDTH,
                terminal: Some(WIGGLE_ARPEGGIATO_UP_ARROW),
                terminal_width: WIGGLE_ARPEGGIATO_ARROW_WIDTH,
            },
            Some(ArpeggioDirection::Down) => ArpeggioGlyphs {
                segment: WIGGLE_ARPEGGIATO_DOWN,
                segment_width: WIGGLE_ARPEGGIATO_SEGMENT_WIDTH,
                terminal: Some(WIGGLE_ARPEGGIATO_DOWN_ARROW),
                terminal_width: WIGGLE_ARPEGGIATO_ARROW_WIDTH,
            },
            Some(ArpeggioDirection::Auto) => ArpeggioGlyphs {
                segment: WIGGLE_ARPEGGIATO_UP,
                segment_width: WIGGLE_ARPEGGIATO_SEGMENT_WIDTH,
                terminal: None,
                terminal_width: 0.0,
            },
            None => ArpeggioGlyphs {
                segment: WIGGLE_ARPEGGIATO_UP,
                segment_width: WIGGLE_ARPEGGIATO_SEGMENT_WIDTH,
                terminal: None,
                terminal_width: 0.0,
            },
        }
    }

    /// Describes the multi-segment glyphs needed to render an arpeggio.
    pub struct ArpeggioGlyphs {
        /// The repeating wiggle segment codepoint.
        pub segment: u32,
        /// Horizontal advance width of the segment (staff spaces at font_size = 4*sp).
        pub segment_width: f64,
        /// Optional arrow/terminal codepoint (None for plain arpeggio).
        pub terminal: Option<u32>,
        /// Horizontal advance width of the terminal glyph.
        pub terminal_width: f64,
    }

    /// Get the SMuFL pedal glyph codepoint and width (in staff spaces) for a pedal type.
    /// Returns (codepoint, width_in_staff_spaces).
    pub fn pedal_start_glyph(pedal_type: &crate::model::PedalType) -> (u32, f64) {
        use crate::model::PedalType;
        match pedal_type {
            PedalType::Sustain => (KEYBOARD_PEDAL_PED, 2.604),
            PedalType::Sostenuto => (KEYBOARD_PEDAL_SOST, 3.66),
            PedalType::UnaCorda => (KEYBOARD_PEDAL_PED, 2.604), // reuse Ped glyph
        }
    }

    /// Bounding box of a SMuFL glyph in staff spaces, relative to the glyph origin.
    /// Returns (x, y, width, height) where y is measured downward from origin.
    /// Values derived from Bravura metadata bounding boxes.
    // This is a flat dispatch table mapping SMuFL codepoints to their bounding-box
    // tuples — every line is one constant -> one tuple. Splitting it into
    // per-category helpers would just hide the table behind an extra indirection
    // without adding any logic worth naming.
    #[allow(clippy::too_many_lines)] // Flat codepoint-to-bbox data table; category extraction would add indirection, not cohesion.
    pub fn glyph_bbox(codepoint: u32) -> (f64, f64, f64, f64) {
        match codepoint {
            // Noteheads
            NOTEHEAD_BLACK => (0.0, -0.5, 1.18, 1.0),
            NOTEHEAD_HALF => (0.0, -0.5, 1.18, 1.0),
            NOTEHEAD_WHOLE => (0.0, -0.5, 1.66, 1.0),
            NOTEHEAD_DOUBLE_WHOLE => (-0.18, -0.5, 2.02, 1.0),

            // Rests
            REST_WHOLE => (0.0, -0.5, 1.5, 0.5),
            REST_HALF => (0.0, 0.0, 1.5, 0.5),
            REST_QUARTER => (0.0, -1.5, 0.98, 3.0),
            REST_8TH => (0.0, -1.0, 1.08, 2.0),
            REST_16TH => (0.0, -1.0, 1.36, 3.0),
            REST_32ND => (0.0, -2.0, 1.36, 4.0),
            REST_64TH => (0.0, -2.0, 1.48, 5.0),
            REST_128TH => (0.0, -3.0, 1.48, 6.0),
            REST_256TH => (0.0, -3.0, 1.60, 7.0),
            REST_512TH => (0.0, -4.0, 1.60, 8.0),
            REST_1024TH => (0.0, -4.0, 1.72, 9.0),
            REST_MAXIMA | REST_LONG | REST_DOUBLE_WHOLE => (0.0, -1.0, 1.0, 2.0),

            // Simile (measure-repeat) marks
            REPEAT_1_BAR => (0.0, -1.116, 2.128, 2.116),
            REPEAT_2_BARS => (0.0, -1.116, 3.048, 2.116),
            REPEAT_4_BARS => (0.0, -1.116, 4.928, 2.116),

            // Clefs
            G_CLEF => (0.0, -4.0, 2.68, 6.68),
            G_CLEF_8VB => (0.0, -4.0, 2.68, 7.68),
            G_CLEF_8VA => (0.0, -5.0, 2.68, 7.68),
            G_CLEF_15MB => (0.0, -4.0, 2.68, 7.68),
            G_CLEF_15MA => (0.0, -5.0, 2.68, 7.68),
            C_CLEF => (0.0, -2.0, 2.38, 4.0),
            C_CLEF_8VB => (0.0, -2.0, 2.38, 5.0),
            F_CLEF => (0.0, -1.0, 2.36, 2.52),
            F_CLEF_8VB => (0.0, -1.0, 2.74, 3.52),
            F_CLEF_8VA => (0.0, -2.0, 2.74, 3.52),
            F_CLEF_15MB => (0.0, -1.0, 2.74, 3.52),
            F_CLEF_15MA => (0.0, -2.0, 2.74, 3.52),

            // Time signatures
            TIME_SIG_COMMON => (0.0, -1.0, 1.69, 2.0),
            TIME_SIG_CUT => (0.0, -1.5, 1.69, 3.0),
            TIME_SIG_0..=TIME_SIG_9 => (0.0, -1.0, 1.38, 2.0),
            // Bravura stylistic-set cuts: same 2sp height, condensed widths.
            TIME_SIG_LARGE_0..=TIME_SIG_LARGE_9 => (0.02, -1.03, 0.51, 2.06),
            TIME_SIG_LARGE_COMMON => (0.02, -1.036, 0.528, 2.07),
            TIME_SIG_LARGE_CUT => (0.016, -1.256, 0.528, 2.51),
            TIME_SIG_NARROW_0..=TIME_SIG_NARROW_9 => (0.0, -1.0, 1.03, 2.0),
            TIME_SIG_NARROW_COMMON => (0.0, -1.0, 1.004, 2.0),
            TIME_SIG_NARROW_CUT => (0.0, -1.44, 1.004, 2.88),

            // Accidentals
            ACCIDENTAL_FLAT => (0.0, -1.76, 0.904, 2.26),
            ACCIDENTAL_NATURAL => (0.0, -1.35, 0.672, 2.7),
            ACCIDENTAL_SHARP => (0.0, -1.4, 0.996, 2.8),
            ACCIDENTAL_DOUBLE_FLAT => (0.0, -1.76, 1.644, 2.26),
            ACCIDENTAL_DOUBLE_SHARP => (0.0, -0.5, 0.988, 1.0),
            ACCIDENTAL_PARENS_LEFT => (0.0, -0.992, 0.564, 0.988),
            ACCIDENTAL_PARENS_RIGHT => (0.0, -0.992, 0.564, 0.988),
            ACCIDENTAL_BRACKET_LEFT => (0.0, -0.748, 0.308, 0.752),
            ACCIDENTAL_BRACKET_RIGHT => (0.0, -0.748, 0.308, 0.752),

            // Dynamics — individual letter glyphs
            DYNAMIC_PIANO => (-0.356, -1.096, 1.820, 1.664),
            DYNAMIC_MEZZO => (-0.080, -1.096, 1.864, 1.136),
            DYNAMIC_FORTE => (-0.564, -1.776, 2.020, 2.384),
            DYNAMIC_RINFORZANDO => (-0.080, -1.096, 1.188, 1.096),
            DYNAMIC_SFORZANDO => (0.0, -1.092, 0.916, 1.132),
            DYNAMIC_Z => (-0.120, -1.072, 1.096, 1.112),
            DYNAMIC_NIENTE => (-0.092, -1.096, 1.324, 1.136),
            // Dynamics — pre-composed glyphs (from Bravura metadata)
            DYNAMIC_PPPPPP => (-0.408, -1.096, 8.920, 1.664),
            DYNAMIC_PPPPP => (-0.408, -1.096, 7.500, 1.664),
            DYNAMIC_PPPP => (-0.408, -1.096, 6.080, 1.664),
            DYNAMIC_PPP => (-0.368, -1.096, 4.660, 1.664),
            DYNAMIC_PP => (-0.328, -1.096, 3.240, 1.664),
            DYNAMIC_MP => (-0.080, -1.096, 3.380, 1.664),
            DYNAMIC_MF => (-0.080, -1.724, 3.352, 2.384),
            DYNAMIC_PF => (-0.288, -1.776, 3.368, 2.384),
            DYNAMIC_FF => (-0.540, -1.776, 2.980, 2.384),
            DYNAMIC_FFF => (-0.620, -1.776, 3.940, 2.384),
            DYNAMIC_FFFF => (-0.620, -1.776, 4.900, 2.384),
            DYNAMIC_FFFFF => (-0.620, -1.776, 5.860, 2.384),
            DYNAMIC_FFFFFF => (-0.620, -1.776, 6.820, 2.384),
            DYNAMIC_FORTE_PIANO => (-0.564, -1.776, 3.040, 2.384),
            DYNAMIC_FORZANDO => (-0.564, -1.776, 2.552, 2.384),
            DYNAMIC_SFORZANDO1 => (0.0, -1.776, 2.416, 2.384),
            DYNAMIC_SFORZANDO_PIANO => (0.0, -1.776, 3.380, 2.384),
            DYNAMIC_SFORZANDO_PIANISSIMO => (0.0, -1.776, 4.796, 2.384),
            DYNAMIC_SFORZATO => (0.0, -1.776, 2.932, 2.384),
            DYNAMIC_SFORZATO_PIANO => (0.0, -1.776, 4.304, 2.384),
            DYNAMIC_SFORZATO_FF => (0.0, -1.776, 3.856, 2.384),
            DYNAMIC_RINFORZANDO1 => (-0.080, -1.776, 2.580, 2.384),
            DYNAMIC_RINFORZANDO2 => (-0.080, -1.776, 3.056, 2.384),

            // Augmentation dot
            AUGMENTATION_DOT => (0.0, -0.15, 0.4, 0.3),

            // Metronome note glyphs (stem extends up; notehead near origin)
            MET_NOTE_DOUBLE_WHOLE => (0.0, -0.68, 2.62, 1.352),
            MET_NOTE_WHOLE => (0.0, -0.592, 1.836, 1.092),
            MET_NOTE_HALF_UP => (0.0, -2.752, 1.364, 3.316),
            MET_NOTE_QUARTER_UP => (0.0, -2.752, 1.328, 3.316),
            MET_NOTE_8TH_UP => (0.0, -2.784, 2.136, 3.348),
            MET_NOTE_16TH_UP => (0.0, -2.8, 2.088, 3.364),
            MET_NOTE_32ND_UP => (0.0, -3.692, 2.152, 4.256),
            MET_NOTE_64TH_UP => (0.0, -4.392, 2.148, 4.956),
            MET_AUGMENTATION_DOT => (0.0, -0.31, 0.4, 0.62),

            // Flags
            FLAG_8TH_UP => (0.0, -0.08, 1.14, 2.72),
            FLAG_8TH_DOWN => (-1.14, -2.64, 1.14, 2.72),
            FLAG_16TH_UP => (0.0, -0.08, 1.14, 3.64),
            FLAG_16TH_DOWN => (-1.14, -3.56, 1.14, 3.64),
            FLAG_32ND_UP => (0.0, -0.08, 1.14, 4.56),
            FLAG_32ND_DOWN => (-1.14, -4.48, 1.14, 4.56),
            FLAG_64TH_UP => (0.0, -0.08, 1.14, 5.48),
            FLAG_64TH_DOWN => (-1.14, -5.40, 1.14, 5.48),

            // Barlines
            BARLINE_FINAL => (0.0, 0.0, 0.5, 4.0),
            REPEAT_LEFT | REPEAT_RIGHT | REPEAT_RIGHT_LEFT => (0.0, 0.0, 1.5, 4.0),

            // Breath marks
            BREATH_MARK_COMMA => (0.0, -1.76, 0.48, 1.76),
            BREATH_MARK_TICK => (0.0, -1.48, 0.44, 1.48),
            BREATH_MARK_UPBOW => (0.004, -1.98, 0.992, 1.976),
            BREATH_MARK_SALZEDO => (0.0, -1.76, 0.6, 1.76),

            // Caesuras
            CAESURA => (0.0, -2.128, 1.536, 2.132),
            CAESURA_THICK => (0.0, -2.128, 2.652, 2.128),
            CAESURA_SHORT => (0.0, -2.132, 0.744, 2.132),
            CAESURA_CURVED => (0.0, -2.12, 1.492, 2.12),

            // Fermatas
            FERMATA_ABOVE => (0.012, -1.316, 2.408, 1.328),
            FERMATA_BELOW => (0.012, 0.0, 2.408, 1.328),
            FERMATA_VERY_SHORT_ABOVE => (0.0, -1.796, 2.904, 1.796),
            FERMATA_VERY_SHORT_BELOW => (0.0, 0.0, 2.904, 1.796),
            FERMATA_SHORT_ABOVE => (0.0, -1.364, 2.416, 1.364),
            FERMATA_SHORT_BELOW => (0.0, 0.0, 2.416, 1.364),
            FERMATA_LONG_ABOVE => (0.0, -1.332, 2.412, 1.336),
            FERMATA_LONG_BELOW => (0.0, -0.004, 2.412, 1.336),
            FERMATA_VERY_LONG_ABOVE => (0.0, -1.632, 2.860, 1.632),
            FERMATA_VERY_LONG_BELOW => (0.0, 0.0, 2.860, 1.632),
            FERMATA_LONG_HENZE_ABOVE => (0.004, -1.620, 2.944, 1.620),
            FERMATA_LONG_HENZE_BELOW => (0.004, 0.0, 2.944, 1.620),
            FERMATA_SHORT_HENZE_ABOVE => (0.0, -1.620, 1.736, 1.620),
            FERMATA_SHORT_HENZE_BELOW => (0.0, 0.0, 1.736, 1.620),
            // curlewSign has no `below` variant in SMuFL.
            CURLEW_SIGN => (0.0, -0.792, 2.808, 0.792),

            // String techniques (Bravura: SMuFL y-up bbox flipped to y-down)
            // stringsDownBow: SW=(0,0), NE=(1.248,1.272) → entirely above origin.
            STRINGS_DOWN_BOW => (0.0, -1.272, 1.248, 1.272),
            // stringsUpBow:   SW=(0.004,0.004), NE=(0.996,1.98) → entirely above origin.
            STRINGS_UP_BOW => (0.004, -1.98, 0.992, 1.976),

            // Ornaments
            ORNAMENT_TRILL => (0.0, -1.56, 2.084, 1.6),
            ORNAMENT_TURN => (0.0, -0.872, 1.84, 0.872),
            ORNAMENT_TURN_INVERTED => (-0.012, -0.872, 1.84, 0.872),
            ORNAMENT_DELAYED_TURN => (0.0, -1.224, 1.84, 1.584),
            ORNAMENT_MORDENT => (0.004, -1.276, 2.912, 1.568),
            ORNAMENT_MORDENT_INVERTED => (0.0, -0.98, 2.9, 0.98),
            ORNAMENT_SHORT_TRILL => (0.004, -0.976, 3.936, 0.976),
            ORNAMENT_SCHLEIFER => (0.0, -2.64, 4.572, 2.64),
            ORNAMENT_TRILL_MORDENT => (0.0, -1.332, 3.96, 1.58),

            // Arpeggios — precomposed (origin at bottom, extends upward)
            ARPEGGIATO => (0.0, -5.434, 0.488, 5.434),
            ARPEGGIATO_UP => (0.004, -6.016, 0.912, 6.016),
            ARPEGGIATO_DOWN => (0.004, -6.016, 0.912, 6.016),

            // Arpeggios — multi-segment (horizontal before rotation)
            // bBoxSW.x to bBoxNE.x = width; bBoxSW.y to bBoxNE.y = height
            WIGGLE_ARPEGGIATO_UP => (-0.132, 0.0, 1.3, 0.476),
            WIGGLE_ARPEGGIATO_DOWN => (-0.132, 0.0, 1.3, 0.476),
            WIGGLE_ARPEGGIATO_UP_ARROW => (-0.188, -0.32, 2.252, 0.94),
            WIGGLE_ARPEGGIATO_DOWN_ARROW => (0.004, -0.26, 2.252, 0.94),

            // Glissando — multi-segment (horizontal before rotation); the ink
            // sits above the baseline, so y starts at -height.
            WIGGLE_GLISSANDO => (-0.1, -0.444, 1.224, 0.444),

            // Fingering numbers (compact digit glyphs)
            FINGERING_0 => (0.0, -1.372, 0.668, 1.372),
            FINGERING_1 => (0.0, -1.372, 0.404, 1.372),
            FINGERING_2 => (0.0, -1.372, 0.62, 1.372),
            FINGERING_3 => (0.0, -1.372, 0.572, 1.372),
            FINGERING_4 => (0.0, -1.372, 0.7, 1.372),
            FINGERING_5 => (0.0, -1.372, 0.588, 1.372),

            // Keyboard pedal markings
            KEYBOARD_PEDAL_PED => (0.0, -1.036, 2.604, 1.036),
            KEYBOARD_PEDAL_UP => (0.0, -1.34, 1.34, 1.34),
            KEYBOARD_PEDAL_SOST => (0.0, -1.06, 3.66, 1.06),
            KEYBOARD_PEDAL_HALF => (0.0, -1.0, 1.0, 1.0),

            // Tremolo combining glyphs (centered on origin)
            TREMOLO_1 => (-0.6, -0.376, 1.2, 0.748),
            TREMOLO_2 => (-0.604, -0.748, 1.2, 1.496),
            TREMOLO_3 => (-0.6, -1.112, 1.2, 2.232),

            // Fingered (multi-note) tremolo glyphs — centered on origin, symmetric.
            // Bravura bBoxSW=(-1.66, …), bBoxNE=(1.66, …), so half-width = 1.66sp.
            TREMOLO_FINGERED_1 => (-1.66, -0.304, 3.32, 0.608),
            TREMOLO_FINGERED_2 => (-1.66, -0.664, 3.32, 1.328),
            TREMOLO_FINGERED_3 => (-1.66, -1.028, 3.32, 2.056),

            // Articulations (Bravura glyphBBoxes; SMuFL y-up converted to y-down)
            ARTIC_ACCENT_ABOVE => (0.0, -0.98, 1.356, 0.976),
            ARTIC_ACCENT_BELOW => (0.0, 0.0, 1.356, 0.976),
            ARTIC_STACCATO_ABOVE => (0.0, -0.336, 0.336, 0.336),
            ARTIC_STACCATO_BELOW => (0.0, 0.0, 0.336, 0.336),
            ARTIC_TENUTO_ABOVE => (-0.004, -0.192, 1.356, 0.192),
            ARTIC_TENUTO_BELOW => (-0.004, 0.0, 1.356, 0.192),
            ARTIC_STACCATISSIMO_ABOVE => (0.004, -1.172, 0.396, 1.18),
            ARTIC_STACCATISSIMO_BELOW => (0.004, 0.0, 0.396, 1.18),
            ARTIC_STACCATISSIMO_WEDGE_ABOVE => (0.004, -1.16, 0.352, 1.16),
            ARTIC_STACCATISSIMO_WEDGE_BELOW => (0.004, 0.0, 0.352, 1.16),
            ARTIC_STACCATISSIMO_STROKE_ABOVE => (0.0, -1.16, 0.192, 1.16),
            ARTIC_STACCATISSIMO_STROKE_BELOW => (0.0, 0.0, 0.192, 1.16),
            ARTIC_MARCATO_ABOVE => (-0.004, -1.012, 0.944, 1.016),
            ARTIC_MARCATO_BELOW => (-0.004, 0.0, 0.944, 1.016),
            ARTIC_MARCATO_STACCATO_ABOVE => (-0.004, -1.772, 0.944, 1.772),
            ARTIC_MARCATO_STACCATO_BELOW => (-0.004, 0.0, 0.944, 1.812),
            ARTIC_ACCENT_STACCATO_ABOVE => (0.0, -1.68, 1.356, 1.68),
            ARTIC_ACCENT_STACCATO_BELOW => (-0.004, 0.0, 1.356, 1.644),
            ARTIC_TENUTO_STACCATO_ABOVE => (-0.004, -0.96, 1.356, 0.96),
            ARTIC_TENUTO_STACCATO_BELOW => (-0.004, 0.0, 1.356, 0.968),
            ARTIC_TENUTO_ACCENT_ABOVE => (-0.004, -1.38, 1.36, 1.38),
            ARTIC_TENUTO_ACCENT_BELOW => (-0.004, 0.0, 1.36, 1.38),
            ARTIC_MARCATO_TENUTO_ABOVE => (-0.004, -1.708, 1.356, 1.708),
            ARTIC_MARCATO_TENUTO_BELOW => (-0.004, 0.0, 1.356, 1.716),
            ARTIC_STRESS_ABOVE => (0.0, -0.948, 0.932, 0.928),
            ARTIC_STRESS_BELOW => (0.016, 0.0, 0.928, 0.936),
            ARTIC_UNSTRESS_ABOVE => (0.0, -0.828, 1.528, 0.828),
            ARTIC_UNSTRESS_BELOW => (0.004, 0.0, 1.528, 0.828),

            // Tuplet digits (sit above the baseline; used to center the number
            // on the bracket both horizontally and vertically).
            TUPLET_0 => (-0.001, -1.5, 1.274, 1.532),
            TUPLET_1 => (0.04, -1.488, 0.984, 1.488),
            TUPLET_2 => (0.04, -1.5, 1.276, 1.524),
            TUPLET_3 => (0.04, -1.5, 1.184, 1.532),
            TUPLET_4 => (0.04, -1.488, 1.212, 1.488),
            TUPLET_5 => (0.04, -1.492, 1.268, 1.524),
            TUPLET_6 => (0.041, -1.5, 1.215, 1.532),
            TUPLET_7 => (0.12, -1.488, 1.212, 1.504),
            TUPLET_8 => (0.04, -1.5, 1.252, 1.532),
            TUPLET_9 => (0.04, -1.5, 1.215, 1.532),
            TUPLET_COLON => (0.04, -1.072, 0.444, 0.84),

            // Braces. The brace family sits on its baseline and rises one em;
            // all five cuts share that height and differ only in width.
            BRACE => (
                0.008,
                -BRACE_GLYPH_HEIGHT,
                BRACE_GLYPH_WIDTH,
                BRACE_GLYPH_HEIGHT,
            ),
            BRACE_SMALL => (
                0.0,
                -BRACE_GLYPH_HEIGHT,
                BRACE_SMALL_WIDTH,
                BRACE_GLYPH_HEIGHT,
            ),
            BRACE_LARGE => (
                0.0,
                -BRACE_GLYPH_HEIGHT,
                BRACE_LARGE_WIDTH,
                BRACE_GLYPH_HEIGHT,
            ),
            BRACE_LARGER => (
                0.0,
                -BRACE_GLYPH_HEIGHT,
                BRACE_LARGER_WIDTH,
                BRACE_GLYPH_HEIGHT,
            ),
            BRACE_FLAT => (
                0.0,
                -BRACE_GLYPH_HEIGHT,
                BRACE_FLAT_WIDTH,
                BRACE_GLYPH_HEIGHT,
            ),

            // Fallback: 1 staff space square
            _ => (0.0, -0.5, 1.0, 1.0),
        }
    }

    /// Resolve a SMuFL glyph name to its Unicode codepoint.
    /// Covers clef and dynamics glyph names from the SMuFL specification.
    /// Reference: https://w3c.github.io/smufl/latest/tables/clefs.html
    /// Reference: https://w3c.github.io/smufl/latest/tables/dynamics.html
    pub fn smufl_name_to_codepoint(name: &str) -> Option<u32> {
        match name {
            // Clefs
            "gClef" => Some(G_CLEF),
            "gClef15mb" => Some(G_CLEF_15MB),
            "gClef8vb" => Some(G_CLEF_8VB),
            "gClef8va" => Some(G_CLEF_8VA),
            "gClef15ma" => Some(G_CLEF_15MA),
            "cClef" => Some(C_CLEF),
            "cClef8vb" => Some(C_CLEF_8VB),
            "fClef" => Some(F_CLEF),
            "fClef15mb" => Some(F_CLEF_15MB),
            "fClef8vb" => Some(F_CLEF_8VB),
            "fClef8va" => Some(F_CLEF_8VA),
            "fClef15ma" => Some(F_CLEF_15MA),
            "unpitchedPercussionClef1" => Some(UNPITCHED_PERCUSSION_CLEF_1),
            "6stringTabClef" => Some(TAB_CLEF_6STR),
            // Dynamics — individual letters
            "dynamicPiano" => Some(DYNAMIC_PIANO),
            "dynamicMezzo" => Some(DYNAMIC_MEZZO),
            "dynamicForte" => Some(DYNAMIC_FORTE),
            "dynamicRinforzando" => Some(DYNAMIC_RINFORZANDO),
            "dynamicSforzando" => Some(DYNAMIC_SFORZANDO),
            "dynamicZ" => Some(DYNAMIC_Z),
            "dynamicNiente" => Some(DYNAMIC_NIENTE),
            // Dynamics — combined glyphs
            "dynamicPPPPPP" => Some(DYNAMIC_PPPPPP),
            "dynamicPPPPP" => Some(DYNAMIC_PPPPP),
            "dynamicPPPP" => Some(DYNAMIC_PPPP),
            "dynamicPPP" => Some(DYNAMIC_PPP),
            "dynamicPP" => Some(DYNAMIC_PP),
            "dynamicMP" => Some(DYNAMIC_MP),
            "dynamicMF" => Some(DYNAMIC_MF),
            "dynamicPF" => Some(DYNAMIC_PF),
            "dynamicFF" => Some(DYNAMIC_FF),
            "dynamicFFF" => Some(DYNAMIC_FFF),
            "dynamicFFFF" => Some(DYNAMIC_FFFF),
            "dynamicFFFFF" => Some(DYNAMIC_FFFFF),
            "dynamicFFFFFF" => Some(DYNAMIC_FFFFFF),
            "dynamicFortePiano" => Some(DYNAMIC_FORTE_PIANO),
            "dynamicForzando" => Some(DYNAMIC_FORZANDO),
            "dynamicSforzando1" => Some(DYNAMIC_SFORZANDO1),
            "dynamicSforzandoPiano" => Some(DYNAMIC_SFORZANDO_PIANO),
            "dynamicSforzandoPianissimo" => Some(DYNAMIC_SFORZANDO_PIANISSIMO),
            "dynamicSforzato" => Some(DYNAMIC_SFORZATO),
            "dynamicSforzatoPiano" => Some(DYNAMIC_SFORZATO_PIANO),
            "dynamicSforzatoFF" => Some(DYNAMIC_SFORZATO_FF),
            "dynamicRinforzando1" => Some(DYNAMIC_RINFORZANDO1),
            "dynamicRinforzando2" => Some(DYNAMIC_RINFORZANDO2),
            _ => None,
        }
    }

    /// True if `codepoint` is in the SMuFL Articulation supplement block
    /// (U+E4A0–U+E4BF): accents, staccatos, tenutos, marcatos, and their
    /// ligature combinations. Used to classify already-emitted glyphs when
    /// scanning the display list for collision obstacles.
    pub fn is_articulation(codepoint: u32) -> bool {
        (ARTIC_ACCENT_ABOVE..=0xE4BF).contains(&codepoint)
    }

    /// True if `codepoint` is in the SMuFL Common-ornaments block
    /// (U+E560–U+E5AF), which includes trills, turns, and mordents.
    pub fn is_ornament(codepoint: u32) -> bool {
        (0xE560..=0xE5AF).contains(&codepoint)
    }

    /// True if `codepoint` is one of the five standard accidentals
    /// (U+E260–U+E264: flat, natural, sharp, double-sharp, double-flat). This
    /// deliberately excludes microtonal and enclosure glyphs — callers using
    /// this for above-staff skyline obstacles only care about the common five.
    pub fn is_standard_accidental(codepoint: u32) -> bool {
        (ACCIDENTAL_FLAT..=ACCIDENTAL_DOUBLE_FLAT).contains(&codepoint)
    }

    /// True if `codepoint` is a notehead glyph — the SMuFL Noteheads block
    /// (U+E0A0–U+E0FF) and the Slash-noteheads block (U+E100–U+E10F), covering
    /// standard, percussion/shape, diamond, triangle, and slash noteheads.
    /// Used by the above-staff collision scan to EXCLUDE noteheads (their
    /// skyline is already owned by the note-position math) while treating every
    /// other note-attached glyph as substrate ink.
    pub fn is_notehead(codepoint: u32) -> bool {
        (0xE0A0..=0xE0FF).contains(&codepoint) || (0xE100..=0xE10F).contains(&codepoint)
    }
}

#[cfg(test)]
mod tests {
    use super::smufl;

    #[test]
    fn test_articulation_width_known_glyphs() {
        assert!((smufl::articulation_width(smufl::ARTIC_STACCATO_ABOVE) - 0.336).abs() < 0.001);
        assert!((smufl::articulation_width(smufl::ARTIC_STACCATO_BELOW) - 0.336).abs() < 0.001);
        assert!((smufl::articulation_width(smufl::ARTIC_ACCENT_ABOVE) - 1.356).abs() < 0.001);
        assert!((smufl::articulation_width(smufl::ARTIC_ACCENT_BELOW) - 1.356).abs() < 0.001);
        assert!((smufl::articulation_width(smufl::ARTIC_TENUTO_ABOVE) - 1.356).abs() < 0.001);
        assert!((smufl::articulation_width(smufl::ARTIC_MARCATO_ABOVE) - 0.944).abs() < 0.001);
        assert!(
            (smufl::articulation_width(smufl::ARTIC_STACCATISSIMO_STROKE_ABOVE) - 0.192).abs()
                < 0.001
        );
        assert!(
            (smufl::articulation_width(smufl::ARTIC_STACCATISSIMO_STROKE_BELOW) - 0.192).abs()
                < 0.001
        );
        assert!(
            (smufl::articulation_width(smufl::ARTIC_STACCATISSIMO_ABOVE) - 0.396).abs() < 0.001
        );
        assert!(
            (smufl::articulation_width(smufl::ARTIC_STACCATISSIMO_BELOW) - 0.396).abs() < 0.001
        );
    }

    #[test]
    fn test_articulation_width_fallback() {
        assert!((smufl::articulation_width(0xFFFF) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_stem_anchors_default_matches_oval_constants() {
        // Unknown / round noteheads fall back to the standard oval anchors.
        let a = smufl::stem_anchors(smufl::NOTEHEAD_BLACK);
        assert_eq!(a.up_se, smufl::STEM_UP_SE);
        assert_eq!(a.down_nw, smufl::STEM_DOWN_NW);
        let fallback = smufl::stem_anchors(0xFFFF);
        assert_eq!(fallback.up_se, smufl::STEM_UP_SE);
        assert_eq!(fallback.down_nw, smufl::STEM_DOWN_NW);
    }

    #[test]
    fn test_stem_anchors_per_shape() {
        // X notehead attaches near its outer corners (±0.44sp), unlike the
        // oval's ±0.168sp. Y is screen-space (down-positive), so up-stem Y is
        // negative and down-stem Y positive.
        let x = smufl::stem_anchors(smufl::NOTEHEAD_X_BLACK);
        assert!((x.up_se.1 - (-0.444)).abs() < 1e-6);
        assert!((x.down_nw.1 - 0.44).abs() < 1e-6);

        // Triangle attaches at its flat edge: the SAME Y for up and down stems.
        let tri_up = smufl::stem_anchors(smufl::NOTEHEAD_TRIANGLE_UP_BLACK);
        assert!((tri_up.up_se.1 - tri_up.down_nw.1).abs() < 1e-6);
        let tri_down = smufl::stem_anchors(smufl::NOTEHEAD_TRIANGLE_DOWN_BLACK);
        assert!((tri_down.up_se.1 - tri_down.down_nw.1).abs() < 1e-6);
        // Up- and down-pointing triangles attach on opposite edges.
        assert!(tri_up.up_se.1 > 0.0 && tri_down.up_se.1 < 0.0);

        // Diamond / circle-X attach at the vertical center (Y = 0).
        for cp in [smufl::NOTEHEAD_DIAMOND_BLACK, smufl::NOTEHEAD_CIRCLE_X] {
            let a = smufl::stem_anchors(cp);
            assert_eq!(a.up_se.1, 0.0);
            assert_eq!(a.down_nw.1, 0.0);
        }

        // Down-stems always attach at the left edge (x = 0) for every shape.
        for cp in [
            smufl::NOTEHEAD_X_BLACK,
            smufl::NOTEHEAD_DIAMOND_BLACK,
            smufl::NOTEHEAD_TRIANGLE_UP_BLACK,
            smufl::NOTEHEAD_SLASH_VERTICAL_BLACK,
        ] {
            assert_eq!(smufl::stem_anchors(cp).down_nw.0, 0.0);
        }
    }

    #[test]
    fn test_glyph_bbox_noteheads() {
        let (x, y, w, h) = smufl::glyph_bbox(smufl::NOTEHEAD_BLACK);
        assert_eq!(x, 0.0);
        assert!((w - 1.18).abs() < 0.01);
        assert!(h > 0.0);
        assert!(y < 0.0); // origin is baseline, bbox extends upward

        let (_, _, w2, _) = smufl::glyph_bbox(smufl::NOTEHEAD_WHOLE);
        assert!(w2 > w, "whole note should be wider than black notehead");
    }

    #[test]
    fn test_glyph_bbox_clefs() {
        let (_, _, w, h) = smufl::glyph_bbox(smufl::G_CLEF);
        assert!(w > 2.0, "G clef should be at least 2 staff spaces wide");
        assert!(h > 5.0, "G clef should be tall");

        let (_, _, fw, fh) = smufl::glyph_bbox(smufl::F_CLEF);
        assert!(fw > 1.0);
        assert!(fh > 1.0);
    }

    #[test]
    fn test_glyph_bbox_rests() {
        let (_, _, w, h) = smufl::glyph_bbox(smufl::REST_QUARTER);
        assert!(w > 0.0);
        assert!(h > 0.0);
    }

    #[test]
    fn test_glyph_bbox_fallback() {
        let (x, _y, w, h) = smufl::glyph_bbox(0xFFFF);
        assert_eq!(x, 0.0);
        assert_eq!(w, 1.0);
        assert_eq!(h, 1.0);
    }

    #[test]
    fn test_breath_mark_glyph_default() {
        assert_eq!(smufl::breath_mark_glyph(&None), smufl::BREATH_MARK_COMMA);
    }

    #[test]
    fn test_breath_mark_glyph_variants() {
        use crate::model::BreathMarkSymbol;
        assert_eq!(
            smufl::breath_mark_glyph(&Some(BreathMarkSymbol::Comma)),
            smufl::BREATH_MARK_COMMA
        );
        assert_eq!(
            smufl::breath_mark_glyph(&Some(BreathMarkSymbol::Tick)),
            smufl::BREATH_MARK_TICK
        );
        assert_eq!(
            smufl::breath_mark_glyph(&Some(BreathMarkSymbol::Salzedo)),
            smufl::BREATH_MARK_SALZEDO
        );
    }

    #[test]
    fn test_breath_mark_bbox() {
        let (_, _, w, h) = smufl::glyph_bbox(smufl::BREATH_MARK_COMMA);
        assert!(w > 0.0, "Breath mark comma should have positive width");
        assert!(h > 0.0, "Breath mark comma should have positive height");

        let (_, _, w, h) = smufl::glyph_bbox(smufl::BREATH_MARK_TICK);
        assert!(w > 0.0, "Breath mark tick should have positive width");
        assert!(h > 0.0, "Breath mark tick should have positive height");

        let (_, _, w, h) = smufl::glyph_bbox(smufl::BREATH_MARK_SALZEDO);
        assert!(w > 0.0, "Breath mark salzedo should have positive width");
        assert!(h > 0.0, "Breath mark salzedo should have positive height");
    }

    #[test]
    fn test_fermata_glyph_normal() {
        use crate::model::FermataSymbol;
        let (above, below) = smufl::fermata_glyph(&FermataSymbol::Normal);
        assert_eq!(above, smufl::FERMATA_ABOVE);
        assert_eq!(below, smufl::FERMATA_BELOW);
    }

    #[test]
    fn test_fermata_glyph_all_symbols() {
        use crate::model::FermataSymbol;
        // Mapping per MNX spec:
        // https://w3c-cg.github.io/mnx/docs/mnx-reference/objects/fermata-symbol/
        let cases = [
            (
                FermataSymbol::Angled,
                smufl::FERMATA_SHORT_ABOVE,
                smufl::FERMATA_SHORT_BELOW,
            ),
            (
                FermataSymbol::Square,
                smufl::FERMATA_LONG_ABOVE,
                smufl::FERMATA_LONG_BELOW,
            ),
            (
                FermataSymbol::DoubleAngled,
                smufl::FERMATA_VERY_SHORT_ABOVE,
                smufl::FERMATA_VERY_SHORT_BELOW,
            ),
            (
                FermataSymbol::DoubleSquare,
                smufl::FERMATA_VERY_LONG_ABOVE,
                smufl::FERMATA_VERY_LONG_BELOW,
            ),
            (
                FermataSymbol::DoubleDot,
                smufl::FERMATA_LONG_HENZE_ABOVE,
                smufl::FERMATA_LONG_HENZE_BELOW,
            ),
            (
                FermataSymbol::HalfCurve,
                smufl::FERMATA_SHORT_HENZE_ABOVE,
                smufl::FERMATA_SHORT_HENZE_BELOW,
            ),
            (
                FermataSymbol::Curlew,
                smufl::CURLEW_SIGN,
                smufl::CURLEW_SIGN,
            ),
        ];
        for (sym, want_above, want_below) in cases {
            let (a, b) = smufl::fermata_glyph(&sym);
            assert_eq!(a, want_above, "{:?} above", sym);
            assert_eq!(b, want_below, "{:?} below", sym);
        }
    }

    #[test]
    fn test_fermata_bbox() {
        let (_, _, w, h) = smufl::glyph_bbox(smufl::FERMATA_ABOVE);
        assert!(
            (w - 2.408).abs() < 0.01,
            "Fermata above width should match Bravura metadata"
        );
        assert!(
            (h - 1.328).abs() < 0.01,
            "Fermata above height should match Bravura metadata"
        );

        let (_, _, w, h) = smufl::glyph_bbox(smufl::FERMATA_BELOW);
        assert!(
            (w - 2.408).abs() < 0.01,
            "Fermata below should have same width as above"
        );
        assert!((h - 1.328).abs() < 0.01);

        // Verify all variants have non-fallback bboxes (>1sp wide)
        for cp in [
            smufl::FERMATA_SHORT_ABOVE,
            smufl::FERMATA_LONG_ABOVE,
            smufl::FERMATA_VERY_LONG_ABOVE,
            smufl::FERMATA_VERY_SHORT_ABOVE,
            smufl::FERMATA_LONG_HENZE_ABOVE,
            smufl::FERMATA_SHORT_HENZE_ABOVE,
        ] {
            let (_, _, w, _) = smufl::glyph_bbox(cp);
            assert!(
                w > 1.5,
                "Fermata variant U+{:04X} should have a real bbox, got w={}",
                cp,
                w
            );
        }
    }

    #[test]
    fn test_trill_glyph_returns_ornament_trill() {
        assert_eq!(smufl::trill_glyph(&None), smufl::ORNAMENT_TRILL);
        assert_eq!(smufl::trill_glyph(&Some(1)), smufl::ORNAMENT_TRILL);
        assert_eq!(smufl::trill_glyph(&Some(-1)), smufl::ORNAMENT_TRILL);
        assert_eq!(smufl::trill_glyph(&Some(0)), smufl::ORNAMENT_TRILL);
    }

    #[test]
    fn test_ornament_glyph_mapping() {
        use crate::model::OrnamentType;
        assert_eq!(
            smufl::ornament_glyph(&OrnamentType::Turn),
            smufl::ORNAMENT_TURN
        );
        assert_eq!(
            smufl::ornament_glyph(&OrnamentType::InvertedTurn),
            smufl::ORNAMENT_TURN_INVERTED
        );
        assert_eq!(
            smufl::ornament_glyph(&OrnamentType::Mordent),
            smufl::ORNAMENT_MORDENT
        );
        assert_eq!(
            smufl::ornament_glyph(&OrnamentType::InvertedMordent),
            smufl::ORNAMENT_MORDENT_INVERTED
        );
        assert_eq!(
            smufl::ornament_glyph(&OrnamentType::ShortTrill),
            smufl::ORNAMENT_SHORT_TRILL
        );
        assert_eq!(
            smufl::ornament_glyph(&OrnamentType::TrillMordent),
            smufl::ORNAMENT_TRILL_MORDENT
        );
        assert_eq!(
            smufl::ornament_glyph(&OrnamentType::DelayedTurn),
            smufl::ORNAMENT_DELAYED_TURN
        );
        assert_eq!(
            smufl::ornament_glyph(&OrnamentType::Schleifer),
            smufl::ORNAMENT_SCHLEIFER
        );
    }

    #[test]
    fn test_trill_bbox() {
        let (_, _, w, h) = smufl::glyph_bbox(smufl::ORNAMENT_TRILL);
        assert!(
            (w - 2.084).abs() < 0.01,
            "Trill width should match Bravura metadata"
        );
        assert!(
            (h - 1.6).abs() < 0.01,
            "Trill height should match Bravura metadata"
        );
    }

    #[test]
    fn test_ornament_bboxes_non_fallback() {
        // All ornament glyphs should have specific bboxes, not the 1.0x1.0 fallback
        let ornaments = [
            smufl::ORNAMENT_TRILL,
            smufl::ORNAMENT_TURN,
            smufl::ORNAMENT_TURN_INVERTED,
            smufl::ORNAMENT_DELAYED_TURN,
            smufl::ORNAMENT_MORDENT,
            smufl::ORNAMENT_MORDENT_INVERTED,
            smufl::ORNAMENT_SHORT_TRILL,
            smufl::ORNAMENT_SCHLEIFER,
            smufl::ORNAMENT_TRILL_MORDENT,
        ];
        for cp in ornaments {
            let (_, _, w, _) = smufl::glyph_bbox(cp);
            assert!(
                w > 1.5,
                "Ornament glyph 0x{:X} should have width > 1.5, got {}",
                cp,
                w
            );
        }
    }

    #[test]
    fn test_ornament_new_types_codepoints() {
        // Verify the new ornament codepoints match the SMuFL specification
        assert_eq!(smufl::ORNAMENT_DELAYED_TURN, 0xE569);
        assert_eq!(smufl::ORNAMENT_SCHLEIFER, 0xE587);
        assert_eq!(smufl::ORNAMENT_TRILL_MORDENT, 0xE5BD);
    }

    #[test]
    fn test_ornament_new_types_bboxes() {
        // DelayedTurn (turn with slash) should have similar width to regular turn
        let (_, _, turn_w, _) = smufl::glyph_bbox(smufl::ORNAMENT_TURN);
        let (_, _, dt_w, _) = smufl::glyph_bbox(smufl::ORNAMENT_DELAYED_TURN);
        assert!(
            (turn_w - dt_w).abs() < 0.1,
            "Delayed turn should be similar width to turn"
        );

        // Schleifer is a large ornament
        let (_, _, sch_w, _) = smufl::glyph_bbox(smufl::ORNAMENT_SCHLEIFER);
        assert!(sch_w > 4.0, "Schleifer should be wide: got {}", sch_w);

        // TrillMordent (precomposed) is wider than a simple trill
        let (_, _, trill_w, _) = smufl::glyph_bbox(smufl::ORNAMENT_TRILL);
        let (_, _, tm_w, _) = smufl::glyph_bbox(smufl::ORNAMENT_TRILL_MORDENT);
        assert!(
            tm_w > trill_w,
            "Trill-mordent should be wider than simple trill"
        );
    }

    #[test]
    fn test_fingering_glyph_mapping() {
        assert_eq!(smufl::fingering_glyph(0), Some(smufl::FINGERING_0));
        assert_eq!(smufl::fingering_glyph(1), Some(smufl::FINGERING_1));
        assert_eq!(smufl::fingering_glyph(2), Some(smufl::FINGERING_2));
        assert_eq!(smufl::fingering_glyph(3), Some(smufl::FINGERING_3));
        assert_eq!(smufl::fingering_glyph(4), Some(smufl::FINGERING_4));
        assert_eq!(smufl::fingering_glyph(5), Some(smufl::FINGERING_5));
        assert_eq!(smufl::fingering_glyph(6), None);
    }

    #[test]
    fn test_fingering_codepoints() {
        assert_eq!(smufl::FINGERING_0, 0xED10);
        assert_eq!(smufl::FINGERING_1, 0xED11);
        assert_eq!(smufl::FINGERING_5, 0xED15);
    }

    #[test]
    fn test_fingering_bboxes() {
        for finger in 0..=5 {
            let cp = smufl::fingering_glyph(finger).unwrap();
            let (x, y, w, h) = smufl::glyph_bbox(cp);
            assert_eq!(x, 0.0, "Fingering {} x should be 0", finger);
            assert!(
                y < 0.0,
                "Fingering {} y should be negative (above origin)",
                finger
            );
            assert!(
                w > 0.0 && w < 1.0,
                "Fingering {} width should be compact: got {}",
                finger,
                w
            );
            assert!(
                h > 1.0,
                "Fingering {} height should be > 1sp: got {}",
                finger,
                h
            );
        }
    }

    #[test]
    fn test_smufl_name_to_codepoint_clefs() {
        assert_eq!(smufl::smufl_name_to_codepoint("gClef"), Some(smufl::G_CLEF));
        assert_eq!(smufl::smufl_name_to_codepoint("fClef"), Some(smufl::F_CLEF));
        assert_eq!(smufl::smufl_name_to_codepoint("cClef"), Some(smufl::C_CLEF));
        assert_eq!(
            smufl::smufl_name_to_codepoint("gClef8vb"),
            Some(smufl::G_CLEF_8VB)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("gClef8va"),
            Some(smufl::G_CLEF_8VA)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("gClef15mb"),
            Some(smufl::G_CLEF_15MB)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("gClef15ma"),
            Some(smufl::G_CLEF_15MA)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("fClef8vb"),
            Some(smufl::F_CLEF_8VB)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("fClef8va"),
            Some(smufl::F_CLEF_8VA)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("fClef15mb"),
            Some(smufl::F_CLEF_15MB)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("fClef15ma"),
            Some(smufl::F_CLEF_15MA)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("unpitchedPercussionClef1"),
            Some(smufl::UNPITCHED_PERCUSSION_CLEF_1)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("6stringTabClef"),
            Some(smufl::TAB_CLEF_6STR)
        );
    }

    #[test]
    fn test_smufl_name_to_codepoint_dynamics() {
        assert_eq!(
            smufl::smufl_name_to_codepoint("dynamicPiano"),
            Some(smufl::DYNAMIC_PIANO)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("dynamicForte"),
            Some(smufl::DYNAMIC_FORTE)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("dynamicPPP"),
            Some(smufl::DYNAMIC_PPP)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("dynamicFF"),
            Some(smufl::DYNAMIC_FF)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("dynamicMF"),
            Some(smufl::DYNAMIC_MF)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("dynamicSforzando1"),
            Some(smufl::DYNAMIC_SFORZANDO1)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("dynamicFortePiano"),
            Some(smufl::DYNAMIC_FORTE_PIANO)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("dynamicNiente"),
            Some(smufl::DYNAMIC_NIENTE)
        );
        assert_eq!(
            smufl::smufl_name_to_codepoint("dynamicRinforzando2"),
            Some(smufl::DYNAMIC_RINFORZANDO2)
        );
    }

    #[test]
    fn test_smufl_name_to_codepoint_unknown() {
        assert_eq!(smufl::smufl_name_to_codepoint("unknownGlyph"), None);
        assert_eq!(smufl::smufl_name_to_codepoint(""), None);
    }
}
