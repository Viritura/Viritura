// Auto-generated from tests.rs — test_lyrics
// 4 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::render::*;

#[test]
fn test_lyrics_basic_rendering() {
    // Load lyrics-basic.mnx: "Are you sleep-ing?" on C D E C quarter notes
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/lyrics-basic.mnx"
    ))
    .expect("Failed to read lyrics-basic.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse lyrics-basic.mnx");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all DrawText commands with font "serif" (lyrics)
    let lyric_texts: Vec<&str> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawText { text, font, .. } = c {
                if font == "serif" {
                    Some(text.as_str())
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    // Should contain "Are", "you", "sleep", a dash, and "ing?"
    assert!(
        lyric_texts.contains(&"Are"),
        "Missing lyric 'Are', got: {:?}",
        lyric_texts
    );
    assert!(
        lyric_texts.contains(&"you"),
        "Missing lyric 'you', got: {:?}",
        lyric_texts
    );
    assert!(
        lyric_texts.contains(&"sleep"),
        "Missing lyric 'sleep', got: {:?}",
        lyric_texts
    );
    assert!(
        lyric_texts.contains(&"ing?"),
        "Missing lyric 'ing?', got: {:?}",
        lyric_texts
    );
    // Dash between "sleep" and "ing?" (Unicode hyphen U+2010)
    assert!(
        lyric_texts.contains(&"\u{2010}"),
        "Missing continuation dash between syllables, got: {:?}",
        lyric_texts
    );

    // Verify lyrics are positioned below the staff
    let sp = config.sp;
    let staff_bottom = config.margin_top * sp + 4.0 * sp;
    for cmd in &dl.commands {
        if let RenderCommand::DrawText { y, font, .. } = cmd {
            if font == "serif" {
                assert!(
                    *y > staff_bottom,
                    "Lyric text y={} should be below staff bottom={}",
                    y,
                    staff_bottom
                );
            }
        }
    }

    // Exactly one dash for "sleep" (type: start) — no dash for other syllables
    let dash_count = lyric_texts.iter().filter(|&&t| t == "\u{2010}").count();
    assert_eq!(
        dash_count, 1,
        "Expected exactly 1 continuation dash, got {}",
        dash_count
    );
}

#[test]
fn test_lyrics_multi_line_rendering() {
    // Load lyrics-multi-line.mnx: two verses on C D E C quarter notes
    // Verse 1: "Are you sleep-ing?"
    // Verse 2: "Am  I  sleep-ing?"
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/lyrics-multi-line.mnx"
    ))
    .expect("Failed to read lyrics-multi-line.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse lyrics-multi-line.mnx");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all DrawText commands with font "serif" (lyrics)
    let lyric_cmds: Vec<(&str, f64)> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawText { text, font, y, .. } = c {
                if font == "serif" {
                    Some((text.as_str(), *y))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    let lyric_texts: Vec<&str> = lyric_cmds.iter().map(|(t, _)| *t).collect();

    // Verse 1 syllables
    assert!(
        lyric_texts.contains(&"Are"),
        "Missing verse 1 'Are', got: {:?}",
        lyric_texts
    );
    assert!(
        lyric_texts.contains(&"you"),
        "Missing verse 1 'you', got: {:?}",
        lyric_texts
    );
    // Verse 2 syllables
    assert!(
        lyric_texts.contains(&"Am"),
        "Missing verse 2 'Am', got: {:?}",
        lyric_texts
    );
    assert!(
        lyric_texts.contains(&"I"),
        "Missing verse 2 'I', got: {:?}",
        lyric_texts
    );
    // Both verses share "sleep" and "ing?"
    let sleep_count = lyric_texts.iter().filter(|&&t| t == "sleep").count();
    assert_eq!(
        sleep_count, 2,
        "Expected 'sleep' in both verses, got {}",
        sleep_count
    );
    let ing_count = lyric_texts.iter().filter(|&&t| t == "ing?").count();
    assert_eq!(
        ing_count, 2,
        "Expected 'ing?' in both verses, got {}",
        ing_count
    );

    // Two continuation dashes (one per verse for "sleep" → "ing?")
    let dash_count = lyric_texts.iter().filter(|&&t| t == "\u{2010}").count();
    assert_eq!(
        dash_count, 2,
        "Expected 2 continuation dashes (one per verse), got {}",
        dash_count
    );

    // Verse 2 should render below verse 1 (higher Y value)
    let are_y = lyric_cmds.iter().find(|(t, _)| *t == "Are").unwrap().1;
    let am_y = lyric_cmds.iter().find(|(t, _)| *t == "Am").unwrap().1;
    assert!(
        am_y > are_y,
        "Verse 2 'Am' (y={}) should be below verse 1 'Are' (y={})",
        am_y,
        are_y
    );

    // Verify consistent vertical spacing between verse lines
    let sp = config.sp;
    let expected_spacing = 2.0 * sp;
    let actual_spacing = am_y - are_y;
    assert!(
        (actual_spacing - expected_spacing).abs() < 0.1,
        "Verse spacing should be ~{:.1} sp, got {:.1}",
        expected_spacing,
        actual_spacing
    );
}

#[test]
fn test_lyrics_line_metadata_parsing() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/lyric-line-metadata.mnx"
    ))
    .expect("Failed to read lyric-line-metadata.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse lyric-line-metadata.mnx");

    // Verify global lyrics metadata was parsed
    let global_lyrics = score
        .global
        .lyrics
        .as_ref()
        .expect("Global lyrics should be present");
    let metadata = global_lyrics
        .line_metadata
        .as_ref()
        .expect("lineMetadata should be present");
    assert_eq!(metadata.len(), 4);
    assert_eq!(metadata["1"].label.as_deref(), Some("English"));
    assert_eq!(metadata["1"].lang.as_deref(), Some("en"));
    assert_eq!(metadata["2"].lang.as_deref(), Some("nl"));
    assert_eq!(metadata["4"].lang.as_deref(), Some("es"));

    // Verify lineOrder
    let line_order = global_lyrics
        .line_order
        .as_ref()
        .expect("lineOrder should be present");
    assert_eq!(line_order, &["1", "2", "3", "4"]);
}

#[test]
fn test_lyrics_line_metadata_rendering() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/lyric-line-metadata.mnx"
    ))
    .expect("Failed to read lyric-line-metadata.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse lyric-line-metadata.mnx");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all DrawText commands with font "serif" (lyrics)
    let lyric_cmds: Vec<(&str, f64)> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawText { text, font, y, .. } = c {
                if font == "serif" {
                    Some((text.as_str(), *y))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    let lyric_texts: Vec<&str> = lyric_cmds.iter().map(|(t, _)| *t).collect();

    // All 4 language lines should be present
    assert!(
        lyric_texts.contains(&"I"),
        "Missing English 'I', got: {:?}",
        lyric_texts
    );
    assert!(
        lyric_texts.contains(&"am"),
        "Missing English 'am', got: {:?}",
        lyric_texts
    );
    assert!(
        lyric_texts.contains(&"John!"),
        "Missing English 'John!', got: {:?}",
        lyric_texts
    );
    assert!(
        lyric_texts.contains(&"Ik"),
        "Missing Dutch 'Ik', got: {:?}",
        lyric_texts
    );
    assert!(
        lyric_texts.contains(&"ben"),
        "Missing Dutch 'ben', got: {:?}",
        lyric_texts
    );
    assert!(
        lyric_texts.contains(&"soy"),
        "Missing Spanish 'soy', got: {:?}",
        lyric_texts
    );

    // Verify 4 distinct Y positions for the 4 lyric lines
    let sp = config.sp;
    let staff_bottom = config.margin_top * sp + 4.0 * sp;
    let mut lyric_y_values: Vec<f64> = lyric_cmds
        .iter()
        .filter(|(t, _)| *t != "\u{2010}")
        .map(|(_, y)| (*y * 10.0).round() / 10.0)
        .collect();
    lyric_y_values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    lyric_y_values.dedup();

    // Should have at least 4 distinct Y levels (one per lyric line)
    assert!(
        lyric_y_values.len() >= 4,
        "Expected at least 4 distinct lyric Y positions for 4 languages, got {}: {:?}",
        lyric_y_values.len(),
        lyric_y_values
    );

    // Line 1 (English) should be closest to staff, line 4 (Spanish) farthest
    let i_y = lyric_cmds.iter().find(|(t, _)| *t == "I").unwrap().1;
    let ik_y = lyric_cmds.iter().find(|(t, _)| *t == "Ik").unwrap().1;
    let soy_y = lyric_cmds.iter().find(|(t, _)| *t == "soy").unwrap().1;
    assert!(i_y > staff_bottom, "English lyrics should be below staff");
    assert!(
        ik_y > i_y,
        "Dutch (line 2) should be below English (line 1)"
    );
    assert!(
        soy_y > ik_y,
        "Spanish (line 4) should be below Dutch (line 2)"
    );

    // Continuation dash for Ukrainian line ("start" → "end" syllable)
    let dash_count = lyric_texts.iter().filter(|&&t| t == "\u{2010}").count();
    assert!(
        dash_count >= 1,
        "Expected at least 1 continuation dash for Ukrainian syllables, got {}",
        dash_count
    );
}

#[test]
fn test_lyrics_spacing_prevents_overlap() {
    // Long lyric syllables on short notes should be spaced far enough apart
    // that adjacent lyrics don't overlap
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "lyrics": {"lines": {"1": {"text": "Sleeping", "syllableType": "whole"}}}},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}],
                 "lyrics": {"lines": {"1": {"text": "dreaming", "syllableType": "whole"}}}},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}],
                 "lyrics": {"lines": {"1": {"text": "wishing", "syllableType": "whole"}}}},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}],
                 "lyrics": {"lines": {"1": {"text": "hoping", "syllableType": "whole"}}}},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = crate::parse::parse_mnx(json).expect("Failed to parse");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Collect lyric text positions (x, text) sorted by x
    let mut lyric_positions: Vec<(f64, &str)> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawText { x, text, font, .. } = c {
                if font == "serif" && text != "\u{2010}" {
                    Some((*x, text.as_str()))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    lyric_positions.sort_by(|a, b| a.0.total_cmp(&b.0));

    assert!(
        lyric_positions.len() >= 4,
        "Expected at least 4 lyric syllables, got {}",
        lyric_positions.len()
    );

    // Verify adjacent lyrics have sufficient gap (at least 0.5sp between edges)
    let font_size = 1.6 * sp;
    let char_w = 0.5 * font_size;
    for i in 0..lyric_positions.len() - 1 {
        let (x1, text1) = lyric_positions[i];
        let (x2, _text2) = lyric_positions[i + 1];
        // Text is center-aligned, so right edge = x + text_width/2
        let half_w1 = text1.len() as f64 * char_w * 0.5;
        let gap = (x2 - x1) - half_w1;
        assert!(
            gap > 0.0,
            "Lyric '{}' at x={:.1} overlaps next lyric at x={:.1} (gap={:.1}px, half_w={:.1}px)",
            text1,
            x1,
            x2,
            gap,
            half_w1
        );
    }
}
