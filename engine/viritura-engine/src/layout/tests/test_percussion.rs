// Percussion (drum kit) layout/render tests.

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::mnx_layout::layout_with_mnx_scores;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

const DRUM_KIT_MNX: &str = r#"{
    "mnx": {"version": 1},
    "global": {
        "measures": [{"time": {"count": 4, "unit": 4}}],
        "sounds": {
            "snd-kick":  {"midiNumber": 35, "name": "Bass Drum"},
            "snd-snare": {"midiNumber": 38, "name": "Snare"}
        }
    },
    "parts": [{
        "id": "p1",
        "name": "Drums",
        "kit": {
            "kick":  {"name": "Kick",  "sound": "snd-kick",  "staffPosition": -4},
            "snare": {"name": "Snare", "sound": "snd-snare", "staffPosition": 0,
                      "_x": {"viritura": {"notehead": "x"}}}
        },
        "measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": 0, "glyph": "unpitchedPercussionClef1"}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "kitNotes": [{"kitComponent": "kick"}]},
                {"duration": {"base": "quarter"}, "kitNotes": [{"kitComponent": "snare"}]},
                {"duration": {"base": "quarter"}, "kitNotes": [{"kitComponent": "kick"}]},
                {"duration": {"base": "quarter"}, "kitNotes": [{"kitComponent": "snare"}]}
            ]}]
        }]
    }]
}"#;

fn glyph_codepoints(dl: &DisplayList) -> Vec<u32> {
    dl.commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { codepoint, .. } => Some(*codepoint),
            _ => None,
        })
        .collect()
}

#[test]
fn test_percussion_clef_renders() {
    let score = parse_mnx(DRUM_KIT_MNX).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    let cps = glyph_codepoints(&dl);
    assert!(
        cps.contains(&smufl::UNPITCHED_PERCUSSION_CLEF_1),
        "Expected unpitchedPercussionClef1 (0x{:X}) in render commands",
        smufl::UNPITCHED_PERCUSSION_CLEF_1
    );
}

#[test]
fn test_kit_note_x_notehead_renders() {
    let score = parse_mnx(DRUM_KIT_MNX).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    let cps = glyph_codepoints(&dl);
    // Snare uses notehead "x" → noteheadXBlack for quarter notes
    assert!(
        cps.contains(&smufl::NOTEHEAD_X_BLACK),
        "Expected noteheadXBlack for snare quarter-note kit-notes; got codepoints: {:?}",
        cps
    );
}

#[test]
fn test_kit_note_default_notehead_renders() {
    let score = parse_mnx(DRUM_KIT_MNX).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    let cps = glyph_codepoints(&dl);
    // Kick has no notehead override → noteheadBlack for quarter notes
    assert!(
        cps.contains(&smufl::NOTEHEAD_BLACK),
        "Expected noteheadBlack for kick quarter-note kit-notes"
    );
}

#[test]
fn test_kit_notes_no_accidentals() {
    let score = parse_mnx(DRUM_KIT_MNX).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    let cps = glyph_codepoints(&dl);
    // Kit-notes carry placeholder C4 internally; the renderer must not emit
    // any accidental glyphs for them.
    let acc_codepoints = [
        smufl::ACCIDENTAL_FLAT,
        smufl::ACCIDENTAL_NATURAL,
        smufl::ACCIDENTAL_SHARP,
        smufl::ACCIDENTAL_DOUBLE_FLAT,
        smufl::ACCIDENTAL_DOUBLE_SHARP,
    ];
    for cp in cps {
        assert!(
            !acc_codepoints.contains(&cp),
            "Unexpected accidental glyph 0x{:X} rendered for kit-notes",
            cp
        );
    }
}

#[test]
fn test_percussion_notehead_glyph_selector() {
    use crate::model::kit::NoteheadShape;
    use crate::model::NoteValueBase::*;

    assert_eq!(
        smufl::percussion_notehead_glyph(None, &Quarter),
        smufl::NOTEHEAD_BLACK
    );
    assert_eq!(
        smufl::percussion_notehead_glyph(Some(&NoteheadShape::Normal), &Half),
        smufl::NOTEHEAD_HALF
    );
    assert_eq!(
        smufl::percussion_notehead_glyph(Some(&NoteheadShape::X), &Quarter),
        smufl::NOTEHEAD_X_BLACK
    );
    assert_eq!(
        smufl::percussion_notehead_glyph(Some(&NoteheadShape::X), &Whole),
        smufl::NOTEHEAD_X_WHOLE
    );
    assert_eq!(
        smufl::percussion_notehead_glyph(Some(&NoteheadShape::Diamond), &Half),
        smufl::NOTEHEAD_DIAMOND_HALF
    );
    assert_eq!(
        smufl::percussion_notehead_glyph(Some(&NoteheadShape::CircleX), &Quarter),
        smufl::NOTEHEAD_CIRCLE_X
    );
    assert_eq!(
        smufl::percussion_notehead_glyph(Some(&NoteheadShape::Slash), &Quarter),
        smufl::NOTEHEAD_SLASH_VERTICAL_BLACK
    );
    assert_eq!(
        smufl::percussion_notehead_glyph(Some(&NoteheadShape::TriangleUp), &Quarter),
        smufl::NOTEHEAD_TRIANGLE_UP_BLACK
    );
    assert_eq!(
        smufl::percussion_notehead_glyph(Some(&NoteheadShape::TriangleDown), &Quarter),
        smufl::NOTEHEAD_TRIANGLE_DOWN_BLACK
    );
}

#[test]
fn test_kit_notes_render_at_distinct_staff_positions() {
    // Kick is staffPosition=-4 (below staff), snare is 0 (middle line).
    // The renderer must produce visibly different Y-coordinates for the two
    // noteheads — if both render at the same Y, kit lookup is broken.
    let score = parse_mnx(DRUM_KIT_MNX).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    // Collect notehead glyph Y-positions (kick = noteheadBlack, snare = noteheadXBlack).
    let mut kick_ys: Vec<f64> = Vec::new();
    let mut snare_ys: Vec<f64> = Vec::new();
    for cmd in &dl.commands {
        if let RenderCommand::DrawGlyph { codepoint, y, .. } = cmd {
            if *codepoint == smufl::NOTEHEAD_BLACK {
                kick_ys.push(*y);
            } else if *codepoint == smufl::NOTEHEAD_X_BLACK {
                snare_ys.push(*y);
            }
        }
    }
    assert!(!kick_ys.is_empty(), "no kick noteheads found");
    assert!(!snare_ys.is_empty(), "no snare noteheads found");
    let kick_y = kick_ys[0];
    let snare_y = snare_ys[0];
    assert!(
        (kick_y - snare_y).abs() > 1.0,
        "kick and snare noteheads collapsed to same Y (kick={}, snare={}) — kit staffPosition not honored",
        kick_y,
        snare_y
    );
    // Kick (staffPosition=-4, below staff) should render BELOW snare (staffPosition=0).
    // Canvas Y grows downward, so kick_y > snare_y.
    assert!(
        kick_y > snare_y,
        "kick (staffPosition=-4) should render below snare (staffPosition=0): kick_y={}, snare_y={}",
        kick_y,
        snare_y
    );
}

// Drum-kit MNX with layouts + scores — exercises layout_with_mnx_scores, the
// path the editor uses for the full-score view. Regression test for the bug
// where build_virtual_part_measure dropped the part's kit, causing all
// kit-notes to render at staff_position=0.
const DRUM_KIT_MNX_WITH_LAYOUT: &str = r#"{
    "mnx": {"version": 1},
    "global": {
        "measures": [{"time": {"count": 4, "unit": 4}}],
        "sounds": {
            "snd-kick":  {"midiNumber": 35, "name": "Bass Drum"},
            "snd-snare": {"midiNumber": 38, "name": "Snare"}
        }
    },
    "parts": [{
        "id": "p1",
        "name": "Drums",
        "kit": {
            "kick":  {"name": "Kick",  "sound": "snd-kick",  "staffPosition": -4},
            "snare": {"name": "Snare", "sound": "snd-snare", "staffPosition": 0}
        },
        "measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": 0, "glyph": "unpitchedPercussionClef1"}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "kitNotes": [{"kitComponent": "kick"}]},
                {"duration": {"base": "quarter"}, "kitNotes": [{"kitComponent": "snare"}]},
                {"duration": {"base": "quarter"}, "kitNotes": [{"kitComponent": "kick"}]},
                {"duration": {"base": "quarter"}, "kitNotes": [{"kitComponent": "snare"}]}
            ]}]
        }]
    }],
    "layouts": [{"id": "L1", "content": [{"type": "staff", "sources": [{"part": "p1"}]}]}],
    "scores": [{"name": "Full Score", "layout": "L1"}]
}"#;

#[test]
fn test_kit_notes_distinct_positions_via_layout_with_mnx_scores() {
    // This is the code path used by the editor's full-score view. Before the
    // fix, build_virtual_part_measure constructed ResolvedMeasure with
    // kit: None, collapsing all kit-notes to staff_position=0 (middle line).
    let score = parse_mnx(DRUM_KIT_MNX_WITH_LAYOUT).unwrap();
    let dl = layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);

    let mut notehead_ys: Vec<f64> = Vec::new();
    for cmd in &dl.commands {
        if let RenderCommand::DrawGlyph { codepoint, y, .. } = cmd {
            if *codepoint == smufl::NOTEHEAD_BLACK {
                notehead_ys.push(*y);
            }
        }
    }
    assert!(
        notehead_ys.len() >= 4,
        "expected 4 noteheads, got {}",
        notehead_ys.len()
    );
    let max_y = notehead_ys
        .iter()
        .cloned()
        .fold(f64::NEG_INFINITY, f64::max);
    let min_y = notehead_ys.iter().cloned().fold(f64::INFINITY, f64::min);
    assert!(
        (max_y - min_y).abs() > 1.0,
        "kit-notes collapsed to same Y via layout_with_mnx_scores (max={}, min={}) — kit not propagated to ResolvedMeasure",
        max_y,
        min_y
    );
}
