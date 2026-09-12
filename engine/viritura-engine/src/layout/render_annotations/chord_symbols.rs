//! Chord-symbol placement and rendering.

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::text_styles::{self, FontFamily};
use super::super::types::*;
use crate::model::{
    AugmentedStyle, ChordExtensionPosition, ChordQuality, ChordRoot, ChordRootCase, ChordSymbol,
    ChordSymbolStyle, DiminishedStyle, HalfDiminishedStyle, MajorSeventhStyle, MinorStyle,
};
use crate::render::smufl::smufl;
use crate::render::*;

const CHORD_FONT_SIZE_SP: f64 = 2.4;
const ACCIDENTAL_GAP_SP: f64 = 0.05;

enum ChordRun {
    Text {
        dx: f64,
        baseline_offset: f64,
        text: String,
        size: f64,
    },
    Glyph {
        dx: f64,
        baseline_offset: f64,
        codepoint: u32,
        size: f64,
    },
}

fn push_text_run(
    runs: &mut Vec<ChordRun>,
    dx: &mut f64,
    text: String,
    size: f64,
    baseline_offset: f64,
) -> f64 {
    if text.is_empty() {
        return 0.0;
    }
    if let Some(ChordRun::Text {
        text: previous,
        size: previous_size,
        baseline_offset: previous_offset,
        ..
    }) = runs.last_mut()
    {
        if *previous_size == size && *previous_offset == baseline_offset {
            previous.push_str(&text);
            *dx += text_styles::text_width(&text, size, FontFamily::Serif, false);
            return 0.82 * size - baseline_offset;
        }
    }
    runs.push(ChordRun::Text {
        dx: *dx,
        text: text.clone(),
        size,
        baseline_offset,
    });
    *dx += text_styles::text_width(&text, size, FontFamily::Serif, false);
    0.82 * size - baseline_offset
}

fn push_glyph_run(
    runs: &mut Vec<ChordRun>,
    dx: &mut f64,
    codepoint: u32,
    size: f64,
    text_baseline_offset: f64,
    width: f64,
    gap_sp: f64,
    align_bottom_to_baseline: bool,
    sp: f64,
) -> f64 {
    let glyph_scale = size / 4.0;
    let (_, bbox_y, _, bbox_height) = smufl::glyph_bbox(codepoint);
    let baseline_offset = if align_bottom_to_baseline {
        text_baseline_offset - (bbox_y + bbox_height) * glyph_scale
    } else {
        text_baseline_offset
    };
    *dx += gap_sp * sp;
    runs.push(ChordRun::Glyph {
        dx: *dx,
        baseline_offset,
        codepoint,
        size,
    });
    *dx += width * glyph_scale + gap_sp * sp;
    -(baseline_offset + bbox_y * glyph_scale)
}

fn push_accidental_run(
    runs: &mut Vec<ChordRun>,
    dx: &mut f64,
    alter: Option<i32>,
    size: f64,
    baseline_offset: f64,
    sp: f64,
) -> f64 {
    let Some(alter) = alter else {
        return 0.0;
    };
    let Some(codepoint) = smufl::chord_accidental_glyph(alter) else {
        return 0.0;
    };
    push_glyph_run(
        runs,
        dx,
        codepoint,
        size,
        baseline_offset,
        smufl::chord_accidental_width(alter),
        ACCIDENTAL_GAP_SP,
        true,
        sp,
    )
}

fn push_chord_text_runs(
    runs: &mut Vec<ChordRun>,
    dx: &mut f64,
    text: &str,
    font_size: f64,
    sp: f64,
    ascent: &mut f64,
    extension_position: ChordExtensionPosition,
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
                *ascent = ascent.max(push_text_run(
                    runs,
                    dx,
                    std::mem::take(&mut plain),
                    font_size,
                    0.0,
                ));
                let (size, baseline_offset) = extension_metrics(extension_position, font_size);
                let alter = if marker == '#' {
                    count as i32
                } else {
                    -(count as i32)
                };
                *ascent = ascent.max(push_accidental_run(
                    runs,
                    dx,
                    Some(alter),
                    size,
                    baseline_offset,
                    sp,
                ));
                index += count;
                continue;
            }
        }
        if marker.is_ascii_digit() {
            if plain.ends_with("sus") {
                plain.push(marker);
                index += 1;
                continue;
            }
            *ascent = ascent.max(push_text_run(
                runs,
                dx,
                std::mem::take(&mut plain),
                font_size,
                0.0,
            ));
            let mut digits = String::new();
            while chars.get(index).is_some_and(char::is_ascii_digit) {
                digits.push(chars[index]);
                index += 1;
            }
            let (size, baseline_offset) = extension_metrics(extension_position, font_size);
            *ascent = ascent.max(push_text_run(runs, dx, digits, size, baseline_offset));
            continue;
        }
        plain.push(marker);
        index += 1;
    }
    *ascent = ascent.max(push_text_run(runs, dx, plain, font_size, 0.0));
}

fn extension_metrics(position: ChordExtensionPosition, font_size: f64) -> (f64, f64) {
    match position {
        ChordExtensionPosition::Superscript => (font_size * 0.72, -font_size * 0.28),
        ChordExtensionPosition::Baseline => (font_size, 0.0),
    }
}

fn root_text(chord: &ChordSymbol, style: ChordSymbolStyle) -> String {
    let lower = style.root_case == ChordRootCase::LowercaseMinor
        && matches!(
            chord.quality,
            ChordQuality::Minor | ChordQuality::HalfDiminished | ChordQuality::MinorMajor
        );
    if lower {
        chord.root.step.to_lowercase()
    } else {
        chord.root.step.clone()
    }
}

fn push_quality_glyph(
    runs: &mut Vec<ChordRun>,
    dx: &mut f64,
    codepoint: u32,
    font_size: f64,
    sp: f64,
    ascent: &mut f64,
) {
    *ascent = ascent.max(push_glyph_run(
        runs,
        dx,
        codepoint,
        font_size,
        0.0,
        smufl::chord_symbol_glyph_width(codepoint),
        ACCIDENTAL_GAP_SP,
        false,
        sp,
    ));
}

fn push_extension(
    runs: &mut Vec<ChordRun>,
    dx: &mut f64,
    extension: Option<u32>,
    style: ChordSymbolStyle,
    font_size: f64,
    ascent: &mut f64,
) {
    let Some(extension) = extension else {
        return;
    };
    let (size, baseline_offset) = extension_metrics(style.extensions, font_size);
    *ascent = ascent.max(push_text_run(
        runs,
        dx,
        extension.to_string(),
        size,
        baseline_offset,
    ));
}

fn push_minor_marker(
    runs: &mut Vec<ChordRun>,
    dx: &mut f64,
    style: ChordSymbolStyle,
    font_size: f64,
    sp: f64,
    ascent: &mut f64,
) {
    match style.minor {
        MinorStyle::M => *ascent = ascent.max(push_text_run(runs, dx, "m".into(), font_size, 0.0)),
        MinorStyle::Min => {
            *ascent = ascent.max(push_text_run(runs, dx, "min".into(), font_size, 0.0));
        }
        MinorStyle::Minus => {
            push_quality_glyph(runs, dx, smufl::CHORD_MINOR, font_size, sp, ascent);
        }
        MinorStyle::None => {}
    }
}

fn push_major_seventh_marker(
    runs: &mut Vec<ChordRun>,
    dx: &mut f64,
    style: ChordSymbolStyle,
    font_size: f64,
    sp: f64,
    ascent: &mut f64,
) {
    match style.major_seventh {
        MajorSeventhStyle::Triangle => {
            push_quality_glyph(runs, dx, smufl::CHORD_MAJOR_SEVENTH, font_size, sp, ascent);
        }
        MajorSeventhStyle::Maj => {
            *ascent = ascent.max(push_text_run(runs, dx, "maj".into(), font_size, 0.0));
        }
        MajorSeventhStyle::CapitalM => {
            *ascent = ascent.max(push_text_run(runs, dx, "M".into(), font_size, 0.0));
        }
    }
}

fn push_quality_and_extension(
    runs: &mut Vec<ChordRun>,
    dx: &mut f64,
    chord: &ChordSymbol,
    style: ChordSymbolStyle,
    font_size: f64,
    sp: f64,
    ascent: &mut f64,
) {
    match chord.quality {
        ChordQuality::Major if chord.extension.is_some_and(|extension| extension != 6) => {
            push_major_seventh_marker(runs, dx, style, font_size, sp, ascent);
            push_extension(runs, dx, chord.extension, style, font_size, ascent);
        }
        ChordQuality::Major | ChordQuality::Dominant => {
            push_extension(runs, dx, chord.extension, style, font_size, ascent);
        }
        ChordQuality::Minor => {
            push_minor_marker(runs, dx, style, font_size, sp, ascent);
            push_extension(runs, dx, chord.extension, style, font_size, ascent);
        }
        ChordQuality::Diminished => {
            if style.diminished == DiminishedStyle::Symbol {
                push_quality_glyph(runs, dx, smufl::CHORD_DIMINISHED, font_size, sp, ascent);
            } else {
                *ascent = ascent.max(push_text_run(runs, dx, "dim".into(), font_size, 0.0));
            }
            push_extension(runs, dx, chord.extension, style, font_size, ascent);
        }
        ChordQuality::HalfDiminished => {
            if style.half_diminished == HalfDiminishedStyle::Symbol {
                push_quality_glyph(
                    runs,
                    dx,
                    smufl::CHORD_HALF_DIMINISHED,
                    font_size,
                    sp,
                    ascent,
                );
                push_extension(runs, dx, chord.extension, style, font_size, ascent);
            } else {
                push_minor_marker(runs, dx, style, font_size, sp, ascent);
                push_extension(runs, dx, chord.extension, style, font_size, ascent);
                push_chord_text_runs(runs, dx, "b5", font_size, sp, ascent, style.extensions);
            }
        }
        ChordQuality::Augmented => {
            if style.augmented == AugmentedStyle::Plus {
                push_quality_glyph(runs, dx, smufl::CHORD_AUGMENTED, font_size, sp, ascent);
            } else {
                *ascent = ascent.max(push_text_run(runs, dx, "aug".into(), font_size, 0.0));
            }
            push_extension(runs, dx, chord.extension, style, font_size, ascent);
        }
        ChordQuality::MinorMajor => {
            push_minor_marker(runs, dx, style, font_size, sp, ascent);
            *ascent = ascent.max(push_text_run(runs, dx, "(".into(), font_size, 0.0));
            push_major_seventh_marker(runs, dx, style, font_size, sp, ascent);
            push_extension(runs, dx, chord.extension, style, font_size, ascent);
            *ascent = ascent.max(push_text_run(runs, dx, ")".into(), font_size, 0.0));
        }
        ChordQuality::Power => {
            *ascent = ascent.max(push_text_run(runs, dx, "5".into(), font_size, 0.0));
        }
        ChordQuality::Suspended2 => {
            push_extension(runs, dx, chord.extension, style, font_size, ascent);
            *ascent = ascent.max(push_text_run(runs, dx, "sus2".into(), font_size, 0.0));
        }
        ChordQuality::Suspended4 => {
            push_extension(runs, dx, chord.extension, style, font_size, ascent);
            *ascent = ascent.max(push_text_run(runs, dx, "sus4".into(), font_size, 0.0));
        }
        ChordQuality::Other => {
            push_chord_text_runs(
                runs,
                dx,
                chord.kind_text.as_deref().unwrap_or(""),
                font_size,
                sp,
                ascent,
                style.extensions,
            );
        }
    }
}

fn chord_symbol_runs(
    chord: &ChordSymbol,
    style: ChordSymbolStyle,
    sp: f64,
) -> (Vec<ChordRun>, f64, f64) {
    let font_size = CHORD_FONT_SIZE_SP * sp;
    if let Some(text) = &chord.text_override {
        let width = text_styles::text_width(text, font_size, FontFamily::Serif, false);
        return (
            vec![ChordRun::Text {
                dx: 0.0,
                baseline_offset: 0.0,
                text: text.clone(),
                size: font_size,
            }],
            width,
            0.82 * font_size,
        );
    }

    let mut runs = Vec::new();
    let mut dx = 0.0;
    let mut ascent = 0.82 * font_size;
    ascent = ascent.max(push_text_run(
        &mut runs,
        &mut dx,
        root_text(chord, style),
        font_size,
        0.0,
    ));
    ascent = ascent.max(push_accidental_run(
        &mut runs,
        &mut dx,
        chord.root.alter,
        font_size,
        0.0,
        sp,
    ));
    push_quality_and_extension(&mut runs, &mut dx, chord, style, font_size, sp, &mut ascent);
    if let Some(ChordRoot { step, alter }) = &chord.bass {
        ascent = ascent.max(push_text_run(
            &mut runs,
            &mut dx,
            format!("/{step}"),
            font_size,
            0.0,
        ));
        ascent = ascent.max(push_accidental_run(
            &mut runs, &mut dx, *alter, font_size, 0.0, sp,
        ));
    }
    (runs, dx, ascent)
}

pub(crate) fn chord_symbol_dimensions(
    chord: &ChordSymbol,
    style: ChordSymbolStyle,
    sp: f64,
) -> (f64, f64) {
    let (_, width, ascent) = chord_symbol_runs(chord, style, sp);
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
        let (runs, _, _) = chord_symbol_runs(chord, config.chord_symbol_style, sp);
        for run in runs {
            let command = match run {
                ChordRun::Text {
                    dx,
                    baseline_offset,
                    text,
                    size,
                } => RenderCommand::DrawText {
                    x: chord_x + dx,
                    y: chord_baseline_y + baseline_offset,
                    text,
                    font: "serif".into(),
                    size,
                    color: "#000000".into(),
                    align: TextAlign::Left,
                    baseline: TextBaseline::Alphabetic,
                },
                ChordRun::Glyph {
                    dx,
                    baseline_offset,
                    codepoint,
                    size,
                } => RenderCommand::DrawGlyph {
                    x: chord_x + dx,
                    y: chord_baseline_y + baseline_offset,
                    codepoint,
                    font: "Bravura".into(),
                    size,
                    color: "#000000".into(),
                    rotation: 0.0,
                },
            };
            dl.push_tagged(command, element_id.clone());
        }
    }
}
