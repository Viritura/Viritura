// Auto-generated from tests.rs — test_lyrics
// 4 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::{layout_full_score, layout_score};
use crate::render::*;
use std::collections::HashSet;

#[test]
fn test_line_order_preserves_preceding_rows_across_systems() {
    let used = HashSet::from(["2".to_string()]);
    let global = ["1".to_string(), "2".to_string(), "3".to_string()];
    let order = crate::layout::render_lyrics::line_order_for_used_lines(used, Some(&global));

    assert_eq!(order, Some(vec!["1".to_string(), "2".to_string()]));
}

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
fn test_sparse_lyric_lines_keep_stable_rows_within_system() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "lyrics": {"lineOrder": ["1", "2"]},
            "measures": [{"time": {"count": 4, "unit": 4}}]
        },
        "parts": [{
            "measures": [{
                "sequences": [{
                    "content": [
                        {
                            "duration": {"base": "half"},
                            "lyrics": {"lines": {"1": {"text": "first"}}},
                            "notes": [{"pitch": {"step": "C", "octave": 4}}]
                        },
                        {
                            "duration": {"base": "half"},
                            "lyrics": {"lines": {"2": {"text": "second"}}},
                            "notes": [{"pitch": {"step": "D", "octave": 4}}]
                        }
                    ]
                }]
            }]
        }]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("Failed to parse sparse lyrics");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let lyric_y = |wanted: &str| {
        dl.commands.iter().find_map(|command| match command {
            RenderCommand::DrawText { text, font, y, .. } if font == "serif" && text == wanted => {
                Some(*y)
            }
            _ => None,
        })
    };
    let first_y = lyric_y("first").expect("Missing first lyric line");
    let second_y = lyric_y("second").expect("Missing second lyric line");

    assert!(
        second_y > first_y,
        "A missing first-line syllable must not pull the second lyric line upward"
    );
    let lyric_boxes: Vec<&ElementBBox> = dl
        .element_bboxes
        .iter()
        .filter(|bbox| {
            bbox.element_id.contains("/lyric-") && (bbox.bbox.height - 1.6 * config.sp).abs() < 1e-6
        })
        .collect();
    assert_eq!(lyric_boxes.len(), 2, "Each syllable needs its own hit box");
    assert!(
        lyric_boxes
            .iter()
            .any(|bbox| bbox.element_id.ends_with("/lyric-31")),
        "Line ID 1 should be reversibly encoded in its selection ID"
    );
    assert!(
        lyric_boxes
            .iter()
            .any(|bbox| bbox.element_id.ends_with("/lyric-32")),
        "Line ID 2 should be reversibly encoded in its selection ID"
    );
    for bbox in lyric_boxes {
        assert!(
            dl.element_ids
                .iter()
                .any(|element_id| element_id.as_ref() == Some(&bbox.element_id)),
            "Lyric text must carry the same ID as its hit box"
        );
    }
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

#[test]
fn test_explicit_lyric_extender_continues_across_system_and_part_boundaries() {
    let global_measures: Vec<_> = (0..8)
        .map(|_| serde_json::json!({"time":{"count":4,"unit":4}}))
        .collect();
    let vocal_measures: Vec<_> = (0..8)
        .map(|index| {
            let mut event = serde_json::json!({
                "duration":{"base":"whole"},
                "notes":[{"pitch":{"step":"C","octave":4}}]
            });
            if index == 0 {
                event["id"] = serde_json::json!("lyric-start");
                event["lyrics"] = serde_json::json!({
                    "lines":{"1":{"text":"Ah","extender":{"show":true,"target":"lyric-target"}}}
                });
            }
            serde_json::json!({"sequences":[{"content":[event]}]})
        })
        .collect();
    let accompaniment_measures: Vec<_> = (0..8)
        .map(|index| {
            let mut event = serde_json::json!({
                "duration":{"base":"whole"},
                "notes":[{"pitch":{"step":"G","octave":3}}]
            });
            if index == 7 {
                event["id"] = serde_json::json!("lyric-target");
            }
            serde_json::json!({"sequences":[{"content":[event]}]})
        })
        .collect();
    let json = serde_json::json!({
        "mnx":{"version":1,"support":{"useLyricExtenders":true}},
        "global":{"measures":global_measures},
        "parts":[
            {"measures":vocal_measures},
            {"measures":accompaniment_measures}
        ]
    });
    let score = crate::parse::parse_mnx(&json.to_string()).expect("Failed to parse extender score");
    let mut config = LayoutConfig::default();
    config.page_width = Some(30.0 * config.sp);
    config.page_height = 40.0;
    config.page_margin_left = 0.0;
    config.page_margin_right = 0.0;
    config.page_margin_top = 0.0;
    config.page_margin_bottom = 0.0;
    let dl = layout_full_score(&score, &config);

    let systems: HashSet<usize> = dl
        .measure_bounds
        .iter()
        .map(|bounds| bounds.system_index)
        .collect();
    assert!(
        systems.len() > 1,
        "expected the narrow page to split the measures into systems"
    );
    assert!(
        dl.pages.len() > 1,
        "expected the short page to paginate the systems"
    );
    let extender_segments = dl
        .commands
        .iter()
        .filter(|command| {
            matches!(
                command,
                RenderCommand::DrawLine { width, .. } if (*width - 0.12 * config.sp).abs() < 1e-6
            )
        })
        .count();
    assert_eq!(extender_segments, systems.len());
}

#[test]
fn test_lyric_extender_cache_dependency_tracks_remote_endpoint_duration() {
    let json = serde_json::json!({
        "mnx":{"version":1,"support":{"useLyricExtenders":true}},
        "global":{"measures":[
            {"time":{"count":4,"unit":4}},
            {"time":{"count":4,"unit":4}}
        ]},
        "parts":[
            {"measures":[
                {"sequences":[{"content":[{
                    "id":"lyric-start",
                    "duration":{"base":"quarter"},
                    "notes":[{"pitch":{"step":"C","octave":4}}],
                    "lyrics":{"lines":{"1":{"text":"Ah","extender":{"show":true,"target":"remote-end"}}}}
                }]}]},
                {"sequences":[]}
            ]},
            {"measures":[
                {"sequences":[]},
                {"sequences":[{"content":[{
                    "id":"remote-end",
                    "duration":{"base":"quarter"},
                    "notes":[{"pitch":{"step":"G","octave":3}}]
                }]}]}
            ]}
        ]
    });
    let mut score =
        crate::parse::parse_mnx(&json.to_string()).expect("Failed to parse remote-target score");
    let before = super::super::lyric_extenders::cache_dependency_hash(&score);
    let crate::model::SequenceContent::Event(target) =
        &mut score.parts[1].measures[1].sequences[0].content[0]
    else {
        panic!("remote endpoint should be an event");
    };
    target.duration.base = crate::model::duration::NoteValueBase::Half;
    let after = super::super::lyric_extenders::cache_dependency_hash(&score);
    assert_ne!(
        before, after,
        "remote endpoint changes must invalidate retained systems"
    );
}

#[test]
fn test_lyric_extenders_without_ids_share_the_lyric_text_anchor() {
    let mut json = serde_json::json!({
        "mnx":{"version":1},
        "global":{"measures":[{"time":{"count":4,"unit":4}}]},
        "parts":[{"measures":[{"sequences":[{"content":[
            {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":4}}]},
            {"type":"grace","content":[
                {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":4}}]}
            ]},
            {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"E","octave":4}}],
             "lyrics":{"lines":{"1":{"text":"Ah","extender":{}}}}},
            {"duration":{"base":"half"},"notes":[{"pitch":{"step":"F","octave":4}}]}
        ]}]}]}]
    });
    let config = LayoutConfig::default();
    let score = crate::parse::parse_mnx_strict(&json.to_string()).unwrap();
    let dl = layout_full_score(&score, &config);
    let segments: Vec<_> = dl
        .commands
        .iter()
        .zip(&dl.element_ids)
        .filter_map(|(command, id)| match command {
            RenderCommand::DrawLine { x1, x2, .. }
                if id.as_deref() == Some("p0/m0/s0/e1/lyric-31") =>
            {
                Some((*x1, *x2))
            }
            _ => None,
        })
        .collect();
    assert_eq!(segments.len(), 1);
    assert!(segments[0].1 > segments[0].0);
    assert!(dl
        .commands
        .iter()
        .zip(&dl.element_ids)
        .any(|(command, id)| {
            matches!(command, RenderCommand::DrawText { text, .. } if text == "Ah")
                && id.as_deref() == Some("p0/m0/s0/e1/lyric-31")
        }));
    json["parts"][0]["measures"][0]["sequences"][0]["content"][2]["id"] =
        serde_json::json!("source");
    let identified = crate::parse::parse_mnx_strict(&json.to_string()).unwrap();
    let identified_dl = layout_full_score(&identified, &config);
    let identified_segments: Vec<_> = identified_dl
        .commands
        .iter()
        .zip(&identified_dl.element_ids)
        .filter_map(|(command, id)| match command {
            RenderCommand::DrawLine { x1, x2, .. }
                if id.as_deref() == Some("p0/m0/s0/source/lyric-31") =>
            {
                Some((*x1, *x2))
            }
            _ => None,
        })
        .collect();
    assert_eq!(segments, identified_segments);
}

#[test]
fn test_lyric_extender_inference_tracks_named_voices_across_sequence_reordering() {
    let mut json = serde_json::json!({
        "mnx":{"version":1},
        "global":{"measures":[{"time":{"count":4,"unit":4}},{}]},
        "parts":[{"measures":[
            {"sequences":[{"voice":"singer","content":[
                {"id":"source","duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":4}}],
                 "lyrics":{"lines":{"1":{"text":"Ah","extender":{}}}}}
            ]}]},
            {"sequences":[
                {"voice":"singer","content":[
                    {"id":"last","duration":{"base":"whole"},"notes":[{"pitch":{"step":"D","octave":4}}]}
                ]},
                {"voice":"other","content":[{"duration":{"base":"whole"},"rest":{}}]}
            ]}
        ]}]
    });
    let config = LayoutConfig::default();
    let count = |value: &serde_json::Value| {
        let score = crate::parse::parse_mnx_strict(&value.to_string()).unwrap();
        let dl = layout_full_score(&score, &config);
        dl.commands
            .iter()
            .zip(&dl.element_ids)
            .filter(|(command, id)| {
                matches!(command, RenderCommand::DrawLine { .. })
                    && id.as_deref() == Some("p0/m0/s0/source/lyric-31")
            })
            .count()
    };
    assert_eq!(count(&json), 1);
    json["parts"][0]["measures"][1]["sequences"]
        .as_array_mut()
        .unwrap()
        .swap(0, 1);
    assert_eq!(count(&json), 1);
    let mut score = crate::parse::parse_mnx_strict(&json.to_string()).unwrap();
    let before = super::super::lyric_extenders::cache_dependency_hash(&score);
    score.parts[0].measures[1].sequences[1].voice = Some("different".into());
    assert_ne!(
        before,
        super::super::lyric_extenders::cache_dependency_hash(&score)
    );
}

#[test]
fn test_idless_lyric_extender_keeps_its_source_selection_tag_across_systems() {
    let measures: Vec<_> = (0..4)
        .map(|index| {
            let mut event = serde_json::json!({
                "duration":{"base":"whole"},
                "notes":[{"pitch":{"step":"C","octave":4}}]
            });
            if index == 0 {
                event["lyrics"] = serde_json::json!({
                    "lines":{"1":{"text":"Ah","extender":{"target":"last"}}}
                });
            }
            if index == 3 {
                event["id"] = serde_json::json!("last");
            }
            serde_json::json!({"sequences":[{"content":[event]}]})
        })
        .collect();
    let json = serde_json::json!({
        "mnx":{"version":1,"support":{"useLyricExtenders":true}},
        "global":{"measures":[{"time":{"count":4,"unit":4}},{},{},{}]},
        "parts":[{"measures":measures}]
    });
    let score = crate::parse::parse_mnx_strict(&json.to_string()).unwrap();
    let mut config = LayoutConfig::default();
    config.page_width = Some(20.0 * config.sp);
    config.page_margin_left = 0.0;
    config.page_margin_right = 0.0;
    let dl = layout_full_score(&score, &config);
    let systems: HashSet<_> = dl
        .measure_bounds
        .iter()
        .map(|bounds| bounds.system_index)
        .collect();
    assert!(systems.len() > 1);
    let segments = dl
        .commands
        .iter()
        .zip(&dl.element_ids)
        .filter(|(command, id)| {
            matches!(command, RenderCommand::DrawLine { .. })
                && id.as_deref() == Some("p0/m0/s0/e0/lyric-31")
        })
        .count();
    assert_eq!(segments, systems.len());
}
