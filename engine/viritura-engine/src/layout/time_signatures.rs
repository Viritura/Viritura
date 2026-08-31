//! Time signature glyph layout, independent of where and how often it is drawn.
//!
//! One module owns the geometry so the renderer, the horizontal-spacing pass
//! and the selection hitbox can never drift apart: each of them consumes the
//! same [`TimeSignatureLayout`].
//!
//! Render style chooses glyphs, scale chooses their size, distribution chooses
//! whether the staff or system pass emits them, and position aligns the final
//! ink bounds to the target staff/group. None of those axes implies another.

pub(crate) mod spanning;

use crate::layout::render_annotations::AboveGlyphBox;
use crate::layout::types::MeasureLayout;
use crate::model::time::{
    SenzaMisuraDisplay, TimeSignature, TimeSignatureDisplay, TimeSignatureDistribution,
    TimeSignaturePosition, TimeSignatureRenderStyle, TimeSignatureSettings,
    TIME_SIGNATURE_SCALE_MAX,
};
use crate::model::NoteValueBase;
use crate::render::smufl::smufl;
use crate::render::{DisplayList, RenderCommand};

/// Nominal font size of a staff-size music glyph: one em spans four spaces.
const NOMINAL_SIZE_SP: f64 = 4.0;

/// Clearance between the top staff line and the bottom of an above-staff
/// meter.
const ABOVE_STAFF_GAP_SP: f64 = 1.0;

/// Left bearing between the prefix cursor and the meter's ink. Preserved from
/// the engraving this module replaced so ordinary meters land where they
/// always have; a group-distributed meter takes a little more air because it
/// is read across a larger vertical target.
pub(crate) const LEFT_BEARING_SP: f64 = 0.5;
const GROUP_LEFT_BEARING_SP: f64 = 1.4;

/// Gap the configured distribution leaves between the prefix cursor and ink.
pub(crate) fn left_bearing(settings: TimeSignatureSettings, sp: f64) -> f64 {
    match settings.distribution {
        TimeSignatureDistribution::PerGroup => GROUP_LEFT_BEARING_SP * sp,
        TimeSignatureDistribution::PerStaff => LEFT_BEARING_SP * sp,
    }
}

/// Trailing clearance between the meter's ink and the first note, on top of
/// the measure's own post-prefix padding.
const RESERVE_PAD_SP: f64 = 0.3;

/// One glyph of an engraved time signature, in absolute pixels.
pub(crate) struct TimeSignatureGlyph {
    pub x: f64,
    pub y: f64,
    pub codepoint: u32,
    /// Font size this glyph is drawn at, in pixels.
    pub size: f64,
}

/// Everything a time signature engraves, plus the extents the rest of the
/// layout needs to keep clear of it.
pub(crate) struct TimeSignatureLayout {
    pub glyphs: Vec<TimeSignatureGlyph>,
    /// Ink width of the widest row, in pixels.
    pub width: f64,
    /// Topmost ink (smallest y, +Y down) in absolute pixels.
    pub top_y: f64,
    /// Bottommost ink in absolute pixels.
    pub bottom_y: f64,
}

/// The digit cut a render style engraves with.
fn digits_for(style: TimeSignatureRenderStyle) -> smufl::TimeSigDigits {
    match style {
        TimeSignatureRenderStyle::Narrow => smufl::TimeSigDigits::Narrow,
        TimeSignatureRenderStyle::OutsideStaff => smufl::TimeSigDigits::Large,
        _ => smufl::TimeSigDigits::Regular,
    }
}

/// Glyph size, in pixels. Scale never changes glyph selection or placement.
fn glyph_size(settings: TimeSignatureSettings, sp: f64) -> f64 {
    NOMINAL_SIZE_SP * sp * settings.scale.clamp(0.25, TIME_SIGNATURE_SCALE_MAX)
}

/// Convert a metric quoted in staff spaces at nominal size into pixels at the
/// given glyph size.
fn scaled(metric_sp: f64, size: f64, sp: f64) -> f64 {
    metric_sp * sp * (size / (NOMINAL_SIZE_SP * sp))
}

/// The symbol glyph a `display` value engraves, if it is a symbol at all.
fn symbol_codepoint(
    display: &TimeSignatureDisplay,
    digits: smufl::TimeSigDigits,
) -> Option<(u32, f64)> {
    match display {
        TimeSignatureDisplay::Common => Some((digits.common(), 0.0)),
        // The cut-time symbol's stroke reaches a further half space above and
        // below the C, which the caller does not need to know about beyond
        // its ink extent.
        TimeSignatureDisplay::Cut => Some((digits.cut(), 0.5)),
        TimeSignatureDisplay::SenzaMisura => Some((digits.open(), 0.0)),
        TimeSignatureDisplay::Note => None,
    }
}

/// Note glyph a denominator stands for, e.g. `8` → an eighth note.
fn denominator_note_glyph(unit: u32) -> u32 {
    let base = match unit {
        1 => NoteValueBase::Whole,
        2 => NoteValueBase::Half,
        8 => NoteValueBase::Eighth,
        16 => NoteValueBase::Sixteenth,
        32 => NoteValueBase::ThirtySecond,
        64 => NoteValueBase::SixtyFourth,
        _ => NoteValueBase::Quarter,
    };
    smufl::metronome_note_glyph(&base)
}

/// Total advance of a digit run at the given size.
fn row_width(digits: smufl::TimeSigDigits, text: &str, size: f64, sp: f64) -> f64 {
    text.chars()
        .filter_map(|ch| ch.to_digit(10))
        .map(|d| scaled(digits.digit_advance(d), size, sp))
        .sum()
}

/// Lay out one digit run centred on `center_x`, with each glyph's origin on
/// `center_y` (SMuFL time-signature digits are centred on their origin).
fn push_row(
    out: &mut Vec<TimeSignatureGlyph>,
    digits: smufl::TimeSigDigits,
    text: &str,
    center_x: f64,
    center_y: f64,
    size: f64,
    sp: f64,
) {
    let width = row_width(digits, text, size, sp);
    let mut x = center_x - width * 0.5;
    for ch in text.chars() {
        let Some(d) = ch.to_digit(10) else { continue };
        out.push(TimeSignatureGlyph {
            x,
            y: center_y,
            codepoint: digits.digit(d),
            size,
        });
        x += scaled(digits.digit_advance(d), size, sp);
    }
}

/// Vertical placement of a stacked meter in one style: the numerator's and
/// denominator's glyph origins, plus the half-height of a digit.
struct StackGeometry {
    numerator_y: f64,
    denominator_y: f64,
    half_height: f64,
}

fn stack_geometry(center_y: f64, sp: f64, size: f64) -> StackGeometry {
    // A digit's ink runs one space above and below its origin at nominal
    // size, so half its height scales with the glyph size.
    let half_height = scaled(1.0, size, sp);
    StackGeometry {
        numerator_y: center_y - half_height,
        denominator_y: center_y + half_height,
        half_height,
    }
}

/// Engrave a time signature and align its final ink bounds to a target span.
pub(crate) fn time_signature_layout(
    settings: TimeSignatureSettings,
    ts: &TimeSignature,
    x: f64,
    target_top: f64,
    target_bottom: f64,
    sp: f64,
) -> TimeSignatureLayout {
    if ts.display == Some(TimeSignatureDisplay::SenzaMisura)
        && settings.senza_misura == SenzaMisuraDisplay::Hidden
    {
        return TimeSignatureLayout {
            glyphs: Vec::new(),
            width: 0.0,
            top_y: target_top,
            bottom_y: target_top,
        };
    }
    let digits = digits_for(settings.render_style);
    let size = glyph_size(settings, sp);
    let center_y = (target_top + target_bottom) * 0.5;

    let layout = if let Some(display) = ts.display.as_ref() {
        if let Some((codepoint, extra_reach_sp)) = symbol_codepoint(display, digits) {
            symbol_layout(codepoint, extra_reach_sp, x, center_y, sp, size, digits)
        } else {
            styled_numeric_layout(settings.render_style, ts, x, center_y, sp, size, digits)
        }
    } else {
        styled_numeric_layout(settings.render_style, ts, x, center_y, sp, size, digits)
    };
    align_layout(layout, settings.position, target_top, target_bottom, sp)
}

fn styled_numeric_layout(
    style: TimeSignatureRenderStyle,
    ts: &TimeSignature,
    x: f64,
    center_y: f64,
    sp: f64,
    size: f64,
    digits: smufl::TimeSigDigits,
) -> TimeSignatureLayout {
    match style {
        TimeSignatureRenderStyle::SingleNumber => {
            single_number_layout(ts, x, center_y, sp, size, digits)
        }
        TimeSignatureRenderStyle::NoteValue => note_value_layout(ts, x, center_y, sp, size, digits),
        TimeSignatureRenderStyle::Standard
        | TimeSignatureRenderStyle::Narrow
        | TimeSignatureRenderStyle::OutsideStaff => {
            stacked_layout(ts, x, center_y, sp, size, digits)
        }
    }
}

fn align_layout(
    mut layout: TimeSignatureLayout,
    position: TimeSignaturePosition,
    target_top: f64,
    target_bottom: f64,
    sp: f64,
) -> TimeSignatureLayout {
    let dy = match position {
        TimeSignaturePosition::Center => {
            (target_top + target_bottom - layout.top_y - layout.bottom_y) * 0.5
        }
        TimeSignaturePosition::Top => target_top - layout.top_y,
        TimeSignaturePosition::Bottom => target_bottom - layout.bottom_y,
        TimeSignaturePosition::Above => target_top - ABOVE_STAFF_GAP_SP * sp - layout.bottom_y,
    };
    for glyph in &mut layout.glyphs {
        glyph.y += dy;
    }
    layout.top_y += dy;
    layout.bottom_y += dy;
    layout
}

#[allow(clippy::too_many_arguments)] // geometry inputs: glyph, anchor, and scale are independent
fn symbol_layout(
    codepoint: u32,
    extra_reach_sp: f64,
    x: f64,
    center_y: f64,
    sp: f64,
    size: f64,
    digits: smufl::TimeSigDigits,
) -> TimeSignatureLayout {
    let width = scaled(digits.symbol_advance(codepoint), size, sp);
    let reach = scaled(1.0 + extra_reach_sp, size, sp);
    TimeSignatureLayout {
        glyphs: vec![TimeSignatureGlyph {
            x,
            y: center_y,
            codepoint,
            size,
        }],
        width,
        top_y: center_y - reach,
        bottom_y: center_y + reach,
    }
}

fn stacked_layout(
    ts: &TimeSignature,
    x: f64,
    center_y: f64,
    sp: f64,
    size: f64,
    digits: smufl::TimeSigDigits,
) -> TimeSignatureLayout {
    let numerator = ts.count.to_string();
    let denominator = ts.unit.to_string();
    let width =
        row_width(digits, &numerator, size, sp).max(row_width(digits, &denominator, size, sp));
    let center_x = x + width * 0.5;
    let geometry = stack_geometry(center_y, sp, size);

    let mut glyphs = Vec::new();
    push_row(
        &mut glyphs,
        digits,
        &numerator,
        center_x,
        geometry.numerator_y,
        size,
        sp,
    );
    push_row(
        &mut glyphs,
        digits,
        &denominator,
        center_x,
        geometry.denominator_y,
        size,
        sp,
    );

    TimeSignatureLayout {
        glyphs,
        width,
        top_y: geometry.numerator_y - geometry.half_height,
        bottom_y: geometry.denominator_y + geometry.half_height,
    }
}

fn single_number_layout(
    ts: &TimeSignature,
    x: f64,
    center_y: f64,
    sp: f64,
    size: f64,
    digits: smufl::TimeSigDigits,
) -> TimeSignatureLayout {
    let numerator = ts.count.to_string();
    let width = row_width(digits, &numerator, size, sp);
    let center_x = x + width * 0.5;
    let half_height = scaled(1.0, size, sp);

    let mut glyphs = Vec::new();
    push_row(
        &mut glyphs,
        digits,
        &numerator,
        center_x,
        center_y,
        size,
        sp,
    );

    TimeSignatureLayout {
        glyphs,
        width,
        top_y: center_y - half_height,
        bottom_y: center_y + half_height,
    }
}

/// A note-value meter sets the beat count over the note the denominator
/// stands for (6 over an eighth note rather than 6/8), which is how MNX's
/// `display: "note"` reads.
fn note_value_layout(
    ts: &TimeSignature,
    x: f64,
    center_y: f64,
    sp: f64,
    size: f64,
    digits: smufl::TimeSigDigits,
) -> TimeSignatureLayout {
    let numerator = ts.count.to_string();
    let note = denominator_note_glyph(ts.unit);
    let (_bx, note_top_sp, note_width_sp, note_height_sp) = smufl::glyph_bbox(note);

    let geometry = stack_geometry(center_y, sp, size);
    // The note carries the same visual weight as the digit it replaces, so it
    // is scaled until its ink is as tall as a digit rather than drawn at the
    // digit's font size — a stemmed note glyph is over three spaces tall and
    // would otherwise hang well below the staff.
    let note_size = if note_height_sp > 0.0 {
        size * (2.0 / note_height_sp)
    } else {
        size
    };
    let note_width = scaled(note_width_sp, note_size, sp);
    let note_ink_height = scaled(note_height_sp, note_size, sp);
    let note_top = scaled(note_top_sp, note_size, sp);

    let numerator_width = row_width(digits, &numerator, size, sp);
    let width = numerator_width.max(note_width);
    let center_x = x + width * 0.5;

    let mut glyphs = Vec::new();
    push_row(
        &mut glyphs,
        digits,
        &numerator,
        center_x,
        geometry.numerator_y,
        size,
        sp,
    );

    // Centre the note's ink on the denominator's slot: its origin sits at the
    // notehead, with the stem reaching upward. Horizontally it is the
    // notehead, not the stem-and-flag ink, that should sit under the beat
    // count — a flag hanging off the right would otherwise pull the whole
    // glyph left of centre.
    let note_y = geometry.denominator_y - (note_top + note_ink_height * 0.5);
    let (_hx, _htop, notehead_width_sp, _hh) = smufl::glyph_bbox(smufl::NOTEHEAD_BLACK);
    let notehead_width = scaled(notehead_width_sp, note_size, sp);
    glyphs.push(TimeSignatureGlyph {
        x: center_x - notehead_width * 0.5,
        y: note_y,
        codepoint: note,
        size: note_size,
    });

    TimeSignatureLayout {
        glyphs,
        width,
        top_y: geometry.numerator_y - geometry.half_height,
        bottom_y: (note_y + note_top + note_ink_height).max(geometry.denominator_y),
    }
}

/// Horizontal room the measure prefix reserves for this meter, measured from
/// the prefix cursor (the meter's left bearing included) to the start of the
/// note area.
///
/// Centered meters reserve their measured ink width plus explicit bearings.
/// Above-target meters float over the music and reserve no horizontal slot.
pub(crate) fn prefix_reserve(settings: TimeSignatureSettings, ts: &TimeSignature, sp: f64) -> f64 {
    if settings.position == TimeSignaturePosition::Above
        || (ts.display == Some(TimeSignatureDisplay::SenzaMisura)
            && settings.senza_misura == SenzaMisuraDisplay::Hidden)
    {
        return 0.0;
    }
    let ink = time_signature_layout(settings, ts, 0.0, 0.0, 4.0 * sp, sp).width;
    left_bearing(settings, sp) + RESERVE_PAD_SP * sp + ink
}

/// Draw a laid-out meter.
pub(crate) fn render_time_signature_layout(dl: &mut DisplayList, layout: &TimeSignatureLayout) {
    for glyph in &layout.glyphs {
        dl.push(RenderCommand::DrawGlyph {
            x: glyph.x,
            y: glyph.y,
            codepoint: glyph.codepoint,
            font: "Bravura".into(),
            size: glyph.size,
            color: "#000000".into(),
            rotation: 0.0,
        });
    }
}

/// Padding the measure prefix keeps between its last element and the first
/// note. Mirrors the constant the measure layout applies.
pub(crate) const PREFIX_TRAILING_PAD_SP: f64 = 1.2;

/// Where a measure's meter ink starts, derived from the prefix boundary the
/// measure was laid out with.
///
/// The renderer nudges this right when a staff's own prefix cursor runs past
/// it (a wide key signature, say); the hitbox and clearance passes use this
/// unadjusted value, which is where the meter sits in every ordinary measure.
pub(crate) fn meter_origin_x(
    ml: &MeasureLayout,
    ts: &TimeSignature,
    settings: TimeSignatureSettings,
    sp: f64,
) -> f64 {
    ml.x + ml.prefix_width - PREFIX_TRAILING_PAD_SP * sp - prefix_reserve(settings, ts, sp)
        + left_bearing(settings, sp)
}

/// The horizontal band an above-staff meter occupies over the top staff line,
/// as `(left, right, top)`, or `None` when this measure engraves no such
/// meter.
///
/// Feeds the same above-staff obstacle list as multimeasure-rest count
/// numbers, so tempo marks and rehearsal marks stack over the meter instead
/// of landing on it.
pub(crate) fn above_staff_extent(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    settings: TimeSignatureSettings,
) -> Option<AboveGlyphBox> {
    if settings.position != TimeSignaturePosition::Above {
        return None;
    }
    let ts = ml.resolved.global.time.as_ref()?;
    let x = meter_origin_x(ml, ts, settings, sp);
    let layout = time_signature_layout(settings, ts, x, staff_y, staff_y + 4.0 * sp, sp);
    if layout.glyphs.is_empty() {
        return None;
    }
    Some((x, x + layout.width, layout.top_y))
}

/// Conservative inter-staff room required when each lower staff owns an
/// above-positioned meter. Uses a stacked pair's full height so every render
/// style fits; single-number and symbol styles simply receive extra air.
pub(crate) fn above_position_clearance(settings: TimeSignatureSettings, sp: f64) -> f64 {
    if settings.position == TimeSignaturePosition::Above {
        (4.0 * settings.scale.clamp(0.25, TIME_SIGNATURE_SCALE_MAX) + ABOVE_STAFF_GAP_SP + 0.5) * sp
    } else {
        0.0
    }
}
