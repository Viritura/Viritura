//! Chord-symbol placement and rendering.

#[path = "chord_symbols/display_interpretation.rs"]
mod display_interpretation;
#[path = "chord_symbols/display_spelling.rs"]
mod display_spelling;
#[path = "chord_symbols/fretboards.rs"]
mod fretboards;
#[cfg(test)]
#[path = "chord_symbols/tests.rs"]
mod tests;

pub(crate) use display_spelling::chord_symbol_for_display;

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
const CHORD_GAP_SP: f64 = 0.75;
const CHORD_NOTE_CLEARANCE_SP: f64 = 0.5;

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
    if alter.unsigned_abs() > 128 {
        // Preserve extreme authored values without allocating unbounded glyph runs.
        return push_text_run(runs, dx, format!("({alter:+})"), size, baseline_offset);
    }
    if alter.unsigned_abs() > 2 {
        // Compound accidentals combine double and single signs rather than
        // silently dropping an alteration introduced by written transposition.
        let mut remaining = alter;
        let mut ascent: f64 = 0.0;
        while remaining != 0 {
            let component = remaining.clamp(-2, 2);
            ascent = ascent.max(push_accidental_run(
                runs,
                dx,
                Some(component),
                size,
                baseline_offset,
                sp,
            ));
            remaining -= component;
        }
        return ascent;
    }
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

fn root_text(root: &ChordRoot, chord: &ChordSymbol, style: ChordSymbolStyle) -> String {
    let lower = style.root_case == ChordRootCase::LowercaseMinor
        && matches!(
            chord.quality,
            Some(ChordQuality::Minor | ChordQuality::HalfDiminished | ChordQuality::MinorMajor)
        );
    if lower {
        root.step.to_lowercase()
    } else {
        root.step.clone()
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
    match chord.quality.unwrap_or(ChordQuality::Major) {
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
    let display = display_interpretation::semantic_display(chord);
    let literal = chord
        .text_override
        .as_ref()
        .or_else(|| chord.raw_text.as_ref().filter(|_| display.is_none()));
    if let Some(text) = literal {
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

    let display = display.unwrap_or_else(|| {
        let mut fallback = chord.clone();
        if fallback.kind_text.is_some() {
            fallback.quality = Some(ChordQuality::Other);
        }
        display_interpretation::SemanticDisplay {
            symbol: fallback,
            modifier_label: String::new(),
        }
    });
    let chord = &display.symbol;
    let Some(root) = &chord.root else {
        return (Vec::new(), 0.0, 0.0);
    };
    let mut runs = Vec::new();
    let mut dx = 0.0;
    let mut ascent = 0.82 * font_size;
    ascent = ascent.max(push_text_run(
        &mut runs,
        &mut dx,
        root_text(root, chord, style),
        font_size,
        0.0,
    ));
    ascent = ascent.max(push_accidental_run(
        &mut runs, &mut dx, root.alter, font_size, 0.0, sp,
    ));
    push_quality_and_extension(&mut runs, &mut dx, chord, style, font_size, sp, &mut ascent);
    push_chord_text_runs(
        &mut runs,
        &mut dx,
        &display.modifier_label,
        font_size,
        sp,
        &mut ascent,
        style.extensions,
    );
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
    match chord.fretboards.first() {
        Some(frame) => {
            let (frame_width, frame_height) = fretboards::dimensions(frame, sp);
            (
                width.max(frame_width),
                ascent + fretboards::LABEL_GAP * sp + frame_height,
            )
        }
        None => (width, ascent),
    }
}

/// Minimum rhythmic content width that keeps sequential chord symbols clear
/// of one another and the closing barline.
pub(crate) fn chord_symbols_min_content_width(
    chords: Option<&[ChordSymbol]>,
    total_beats: f64,
    style: ChordSymbolStyle,
    sp: f64,
) -> f64 {
    let Some(chords) = chords.filter(|chords| !chords.is_empty()) else {
        return 0.0;
    };
    if total_beats <= 0.0 {
        return 0.0;
    }

    let mut extents: Vec<_> = chords
        .iter()
        .map(|chord| {
            let (width, _) = chord_symbol_dimensions(chord, style, sp);
            (chord.position.beats() / total_beats, width)
        })
        .collect();
    extents.sort_by(|left, right| left.0.total_cmp(&right.0));

    let gap = CHORD_GAP_SP * sp;
    let mut required = 0.0_f64;
    for pair in extents.windows(2) {
        let fraction = pair[1].0 - pair[0].0;
        if fraction > f64::EPSILON {
            required = required.max((pair[0].1 + gap) / fraction);
        }
    }
    if let Some((fraction, width)) = extents.last() {
        let remaining = 1.0 - fraction;
        if remaining > f64::EPSILON {
            required = required.max((width + gap) / remaining);
        }
    }
    required
}

/// Extra upward movement needed for a chord symbol to clear noteheads and
/// stems occupying its horizontal ink span.
pub(crate) fn chord_symbol_vertical_lift(
    ml: &MeasureLayout,
    chord: &ChordSymbol,
    chord_x: f64,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) -> f64 {
    let (width, _) = chord_symbol_dimensions(chord, config.chord_symbol_style, sp);
    let note_top = super::substrate_obstacles::highest_point_in_range(
        ml,
        staff_y,
        sp,
        config.stem_length,
        chord_x,
        chord_x + width,
    );
    let attach_gap = config
        .placement
        .resolve(ElementKind::ChordSymbol)
        .attach_gap;
    let chord_bottom = staff_y - attach_gap * sp;
    (chord_bottom - note_top + CHORD_NOTE_CLEARANCE_SP * sp).max(0.0)
}

/// Render chord symbols above the staff at their rhythmic positions.
pub(crate) fn render_chord_symbols(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let chords = match &ml.resolved.chord_symbols {
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
    let measure_index = ml.resolved.index;

    for (index, chord) in chords.iter().enumerate() {
        let chord_x = x_origin + (chord.position.beats() / total_beats) * content_width;
        let source_index = chord.source_index.unwrap_or(index);
        let element_id = element_id::global_chord_symbol(measure_index, source_index);
        let (runs, _, ascent) = chord_symbol_runs(chord, config.chord_symbol_style, sp);
        let vertical_lift = chord_symbol_vertical_lift(ml, chord, chord_x, staff_y, sp, config);
        let chord_baseline_y = staff_y - attach_gap * sp - vertical_lift;
        if let Some(frame) = chord.fretboards.first() {
            let (_, height) = fretboards::dimensions(frame, sp);
            fretboards::render(
                dl,
                frame,
                chord_x,
                chord_baseline_y - ascent - fretboards::LABEL_GAP * sp - height,
                sp,
                &element_id,
            );
        }
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
