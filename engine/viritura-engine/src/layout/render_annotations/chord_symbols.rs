//! Chord-symbol placement and rendering.

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::text_styles::{self, FontFamily};
use super::super::types::*;
use crate::model::{ChordRoot, ChordSymbol};
use crate::render::smufl::smufl;
use crate::render::*;

const CHORD_FONT_SIZE_SP: f64 = 2.4;
const ACCIDENTAL_GAP_SP: f64 = 0.05;

enum ChordRun {
    Text {
        dx: f64,
        text: String,
    },
    Glyph {
        dx: f64,
        baseline_offset: f64,
        codepoint: u32,
    },
}

fn push_text_run(runs: &mut Vec<ChordRun>, dx: &mut f64, text: String, font_size: f64) {
    if text.is_empty() {
        return;
    }
    runs.push(ChordRun::Text {
        dx: *dx,
        text: text.clone(),
    });
    *dx += text_styles::text_width(&text, font_size, FontFamily::Serif, false);
}

fn push_accidental_run(runs: &mut Vec<ChordRun>, dx: &mut f64, alter: Option<i32>, sp: f64) -> f64 {
    let Some(alter) = alter else {
        return 0.0;
    };
    let Some(codepoint) = smufl::accidental_glyph(alter) else {
        return 0.0;
    };
    let glyph_size = CHORD_FONT_SIZE_SP * sp;
    let glyph_scale = glyph_size / 4.0;
    let (_, bbox_y, _, bbox_height) = smufl::glyph_bbox(codepoint);
    let baseline_offset = -(bbox_y + bbox_height) * glyph_scale;
    *dx += ACCIDENTAL_GAP_SP * sp;
    runs.push(ChordRun::Glyph {
        dx: *dx,
        baseline_offset,
        codepoint,
    });
    *dx += smufl::accidental_width(alter) * glyph_scale + ACCIDENTAL_GAP_SP * sp;
    bbox_height * glyph_scale
}

fn push_chord_text_runs(
    runs: &mut Vec<ChordRun>,
    dx: &mut f64,
    text: &str,
    font_size: f64,
    sp: f64,
    ascent: &mut f64,
) {
    let chars: Vec<char> = text.chars().collect();
    let mut plain = String::new();
    let mut index = 0;
    while index < chars.len() {
        let marker = chars[index];
        if marker == 'b' || marker == '#' {
            let mut count = 1;
            while count < 2 && chars.get(index + count) == Some(&marker) {
                count += 1;
            }
            if chars.get(index + count).is_some_and(char::is_ascii_digit) {
                push_text_run(runs, dx, std::mem::take(&mut plain), font_size);
                let alter = if marker == '#' {
                    count as i32
                } else {
                    -(count as i32)
                };
                *ascent = ascent.max(push_accidental_run(runs, dx, Some(alter), sp));
                index += count;
                continue;
            }
        }
        plain.push(marker);
        index += 1;
    }
    push_text_run(runs, dx, plain, font_size);
}

fn chord_symbol_runs(chord: &ChordSymbol, sp: f64) -> (Vec<ChordRun>, f64, f64) {
    let font_size = CHORD_FONT_SIZE_SP * sp;
    if let Some(text) = &chord.text_override {
        let width = text_styles::text_width(text, font_size, FontFamily::Serif, false);
        return (
            vec![ChordRun::Text {
                dx: 0.0,
                text: text.clone(),
            }],
            width,
            0.82 * font_size,
        );
    }

    let mut runs = Vec::new();
    let mut dx = 0.0;
    let mut ascent = 0.82 * font_size;
    let mut leading_text = chord.root.step.clone();
    if chord.root.alter.is_none() {
        leading_text.push_str(&chord.suffix_text());
    }
    if let Some(bass) = &chord.bass {
        if chord.root.alter.is_none() {
            leading_text.push('/');
            leading_text.push_str(&bass.step);
        }
    }
    push_chord_text_runs(
        &mut runs,
        &mut dx,
        &leading_text,
        font_size,
        sp,
        &mut ascent,
    );
    ascent = ascent.max(push_accidental_run(
        &mut runs,
        &mut dx,
        chord.root.alter,
        sp,
    ));
    if chord.root.alter.is_some() {
        let mut trailing_text = chord.suffix_text();
        if let Some(bass) = &chord.bass {
            trailing_text.push('/');
            trailing_text.push_str(&bass.step);
        }
        push_chord_text_runs(
            &mut runs,
            &mut dx,
            &trailing_text,
            font_size,
            sp,
            &mut ascent,
        );
    }
    if let Some(ChordRoot { alter, .. }) = &chord.bass {
        ascent = ascent.max(push_accidental_run(&mut runs, &mut dx, *alter, sp));
    }
    (runs, dx, ascent)
}

pub(crate) fn chord_symbol_dimensions(chord: &ChordSymbol, sp: f64) -> (f64, f64) {
    let (_, width, ascent) = chord_symbol_runs(chord, sp);
    (width, ascent)
}

/// Render chord symbols above the staff at their rhythmic positions.
pub(crate) fn render_chord_symbols(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let chords = match &ml.resolved.part.chord_symbols {
        Some(chords) if !chords.is_empty() => chords,
        _ => return,
    };

    let total_beats = ml.resolved.active_time.measure_beats();
    let content_width = super::super::render_barlines::rhythmic_content_width(ml, sp);
    let x_origin = ml.x + ml.prefix_width;
    let font_size = CHORD_FONT_SIZE_SP * sp;
    let attach_gap = config
        .placement
        .resolve(ElementKind::ChordSymbol)
        .attach_gap;
    let chord_baseline_y = staff_y - attach_gap * sp;
    let measure_index = ml.resolved.index;
    let part_index = ml.part_index;

    for (index, chord) in chords.iter().enumerate() {
        let chord_x = x_origin + (chord.position.beats() / total_beats) * content_width;
        let element_id = element_id::chord_symbol(
            chord.source_part_index.unwrap_or(part_index),
            measure_index,
            chord.source_index.unwrap_or(index),
        );
        let (runs, _, _) = chord_symbol_runs(chord, sp);
        for run in runs {
            let command = match run {
                ChordRun::Text { dx, text } => RenderCommand::DrawText {
                    x: chord_x + dx,
                    y: chord_baseline_y,
                    text,
                    font: "serif".into(),
                    size: font_size,
                    color: "#000000".into(),
                    align: TextAlign::Left,
                    baseline: TextBaseline::Alphabetic,
                },
                ChordRun::Glyph {
                    dx,
                    baseline_offset,
                    codepoint,
                } => RenderCommand::DrawGlyph {
                    x: chord_x + dx,
                    y: chord_baseline_y + baseline_offset,
                    codepoint,
                    font: "Bravura".into(),
                    size: font_size,
                    color: "#000000".into(),
                    rotation: 0.0,
                },
            };
            dl.push_tagged(command, element_id.clone());
        }
    }
}
