#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_events::{ArticCategory, ArticGlyph};
use super::super::render_geometry::*;
use super::super::resolve::*;
use super::super::slurs::{SlurParticipationMap, SlurRole, SlurSide};
use super::super::spacing::*;
use super::super::types::*;
use super::articulations::*;
use super::fermatas_trills_ornaments::*;
use super::fingerings::*;
use super::tremolo_breath::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Render arpeggio markings (wavy vertical lines) to the left of chords.
///
/// Uses multi-segment SMuFL glyphs (wiggleArpeggiatoUp/Down) per the SMuFL spec:
/// "Scoring applications should draw arpeggiato markings using multiple instances
/// of the appropriate wiggly line segment glyphs rather than the precomposed glyphs."
///
/// The horizontal wiggle glyphs are rotated -90° (CCW) and tiled vertically to span
/// from the lowest note to the highest note, with optional arrow terminals.
pub(crate) fn render_arpeggios(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    use std::f64::consts::FRAC_PI_2;

    let font_size = 4.0 * sp; // Standard SMuFL font size
    let rotation = -FRAC_PI_2; // -90° CCW: horizontal glyphs become vertical

    // An arpeggio sits to the LEFT of the chord. When the chord shows
    // accidentals, the wavy line must clear the accidental column, not the
    // notehead — otherwise it is drawn on top of the accidentals and shoved
    // into the previous event (the classic arpeggio+accidental collision).
    let acc_extents = build_event_accidental_extents(ml);

    if let Some(arpeggios) = &ml.resolved.part.arpeggios {
        for arpeggio in arpeggios {
            if let Some(span) = resolve_note_span(ml, &arpeggio.span.start, &arpeggio.span.end, sp)
            {
                let extra_left = arpeggio_accidental_clearance(
                    resolve_event_index(ml, &arpeggio.span.start)
                        .and_then(|k| acc_extents.get(&k).copied()),
                    sp,
                );
                let command_start = dl.commands.len();
                render_arpeggio_span(
                    dl,
                    span,
                    arpeggio.direction.clone(),
                    arpeggio.arrow.unwrap_or(false),
                    staff_y,
                    sp,
                    config,
                    font_size,
                    rotation,
                    extra_left,
                );
                tag_arpeggio(
                    dl,
                    ml,
                    &arpeggio.span.start,
                    span,
                    staff_y,
                    sp,
                    config,
                    extra_left,
                    command_start,
                    false,
                );
            }
        }
    } else {
        render_legacy_event_arpeggios(
            dl,
            ml,
            staff_y,
            sp,
            config,
            font_size,
            rotation,
            &acc_extents,
        );
    }

    if let Some(non_arpeggios) = &ml.resolved.part.non_arpeggios {
        for non_arpeggio in non_arpeggios {
            if let Some(span) =
                resolve_note_span(ml, &non_arpeggio.span.start, &non_arpeggio.span.end, sp)
            {
                let extra_left = arpeggio_accidental_clearance(
                    resolve_event_index(ml, &non_arpeggio.span.start)
                        .and_then(|k| acc_extents.get(&k).copied()),
                    sp,
                );
                let command_start = dl.commands.len();
                render_non_arpeggio_span(dl, span, staff_y, sp, config, extra_left);
                tag_arpeggio(
                    dl,
                    ml,
                    &non_arpeggio.span.start,
                    span,
                    staff_y,
                    sp,
                    config,
                    extra_left,
                    command_start,
                    true,
                );
            }
        }
    }
}

/// Per-event leftward accidental-column extent (in spatium), keyed by
/// `(voice-layout index, event index)`, computed in the renderer's event order
/// so running same-measure accidental cancellation matches what is drawn.
/// Events with no visible accidentals are omitted. Uses concert pitches
/// (`Event::notes`), consistent with the spacing reservation in
/// `spacing::event_accidental_extent_sp`.
fn build_event_accidental_extents(ml: &MeasureLayout) -> HashMap<(usize, usize), f64> {
    let mut map = HashMap::new();
    let mut measure_acc: HashMap<(String, i32), i32> = HashMap::new();
    let active_key = &ml.resolved.active_key;
    for (vi, vl) in ml.voice_layouts.iter().enumerate() {
        for ei in 0..vl.events.len() {
            let extent = event_accidental_extent_sp(
                vl.events.event(ei).notes(),
                active_key,
                &mut measure_acc,
                None,
                0.0,
                None,
            );
            if extent > 0.0 {
                map.insert((vi, ei), extent);
            }
        }
    }
    map
}

/// Locate the `(voice-layout index, event index)` of the event owning `note_id`.
pub(super) fn resolve_event_index(ml: &MeasureLayout, note_id: &str) -> Option<(usize, usize)> {
    for (vi, vl) in ml.voice_layouts.iter().enumerate() {
        for ei in 0..vl.events.len() {
            if vl
                .events
                .event(ei)
                .notes()
                .iter()
                .any(|n| n.id.as_deref() == Some(note_id))
            {
                return Some((vi, ei));
            }
        }
    }
    None
}

/// Additional leftward shift (px) so an arpeggio (or non-arpeggio bracket)
/// clears an accidental column to the left of the chord. Returns 0 when the
/// chord shows no accidentals, preserving the original notehead-relative
/// placement.
fn arpeggio_accidental_clearance(extent_sp: Option<f64>, sp: f64) -> f64 {
    // Matches the notehead gap in `render_accidentals_stacked` / the spacing
    // reservation in `accidental_padding_sp`.
    const ACC_NOTE_GAP: f64 = 0.20;
    match extent_sp {
        Some(e) if e > 0.0 => (ACC_NOTE_GAP + e) * sp,
        _ => 0.0,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn render_legacy_event_arpeggios(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    font_size: f64,
    rotation: f64,
    acc_extents: &HashMap<(usize, usize), f64>,
) {
    for (vi, vl) in ml.voice_layouts.iter().enumerate() {
        for ei in 0..vl.events.len() {
            let el = vl.events.to_event_layout(ei);
            let arpeggio = match &el.event.markings {
                Some(m) => match &m.arpeggio {
                    Some(a) => a,
                    None => continue,
                },
                None => continue,
            };

            if el.note_positions.len() < 2 {
                continue;
            }

            let top_pos = el
                .note_positions
                .iter()
                .cloned()
                .fold(f64::INFINITY, f64::min);
            let bottom_pos = el
                .note_positions
                .iter()
                .cloned()
                .fold(f64::NEG_INFINITY, f64::max);
            let min_x = notehead_x_range(&el, sp).map(|(x, _)| x).unwrap_or(el.x);
            let span = RenderedNoteSpan {
                min_x,
                top_pos,
                bottom_pos,
            };
            let arrow = !matches!(
                arpeggio.direction,
                None | Some(crate::model::ArpeggioDirection::Auto)
            );
            let extra_left = arpeggio_accidental_clearance(acc_extents.get(&(vi, ei)).copied(), sp);
            let command_start = dl.commands.len();
            render_arpeggio_span(
                dl,
                span,
                arpeggio.direction.clone(),
                arrow,
                staff_y,
                sp,
                config,
                font_size,
                rotation,
                extra_left,
            );
            let event_id = el
                .event
                .id
                .as_deref()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("e{}", ei));
            let base_id = element_id::event(
                vl.part_index_override.unwrap_or(ml.part_index),
                ml.resolved.index,
                vl.seq_index_override.unwrap_or(vl.voice_index),
                &event_id,
            );
            tag_arpeggio_with_id(
                dl,
                element_id::arpeggio(&base_id),
                span,
                staff_y,
                sp,
                config,
                extra_left,
                command_start,
                false,
            );
        }
    }
}

#[allow(clippy::too_many_arguments)] // Rendering geometry and selection identity are all required at this boundary.
fn tag_arpeggio(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    start_note_id: &str,
    span: RenderedNoteSpan,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    extra_left: f64,
    command_start: usize,
    non_arpeggio: bool,
) {
    let Some((voice_index, event_index)) = resolve_event_index(ml, start_note_id) else {
        return;
    };
    let voice = &ml.voice_layouts[voice_index];
    let event = voice.events.event(event_index);
    let event_id = event
        .id
        .as_deref()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("e{}", event_index));
    let base_id = element_id::event(
        voice.part_index_override.unwrap_or(ml.part_index),
        ml.resolved.index,
        voice.seq_index_override.unwrap_or(voice.voice_index),
        &event_id,
    );
    tag_arpeggio_with_id(
        dl,
        element_id::arpeggio(&base_id),
        span,
        staff_y,
        sp,
        config,
        extra_left,
        command_start,
        non_arpeggio,
    );
}

#[allow(clippy::too_many_arguments)] // The bbox must use the same complete geometry input as the rendered mark.
fn tag_arpeggio_with_id(
    dl: &mut DisplayList,
    element_id: String,
    span: RenderedNoteSpan,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    extra_left: f64,
    command_start: usize,
    non_arpeggio: bool,
) {
    for command_index in command_start..dl.commands.len() {
        dl.tag_command(command_index, element_id.clone());
    }
    let top_y = staff_y + (span.top_pos - 0.5) * sp * 0.5;
    let bottom_y = staff_y + (span.bottom_pos + 0.5) * sp * 0.5;
    let width = if non_arpeggio { 0.95 * sp } else { 1.2 * sp };
    let x = span.min_x - config.arpeggio_offset * sp - extra_left;
    dl.push_element_bbox_with_shape(ElementBBox {
        element_id,
        bbox: BoundingBox::new(
            x - 0.4 * sp,
            top_y - 0.65 * sp,
            width,
            bottom_y - top_y + 1.3 * sp,
        ),
    });
}

#[derive(Clone, Copy)]
pub(super) struct RenderedNoteSpan {
    pub(super) min_x: f64,
    pub(super) top_pos: f64,
    pub(super) bottom_pos: f64,
}

pub(super) fn notehead_x_range(el: &EventLayout, sp: f64) -> Option<(f64, f64)> {
    if el.event.notes().is_empty() {
        return None;
    }
    let notehead_w = smufl::notehead_width(smufl::NOTEHEAD_BLACK) * sp;
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    for i in 0..el.event.notes().len() {
        let x = el.x + el.note_x_offsets.get(i).copied().unwrap_or(0.0) * notehead_w;
        min_x = min_x.min(x);
        max_x = max_x.max(x);
    }
    Some((min_x, max_x))
}

pub(super) fn resolve_note_endpoint(
    ml: &MeasureLayout,
    note_id: &str,
    sp: f64,
) -> Option<(f64, f64)> {
    let notehead_w = smufl::notehead_width(smufl::NOTEHEAD_BLACK) * sp;
    for vl in &ml.voice_layouts {
        for ei in 0..vl.events.len() {
            let el = vl.events.to_event_layout(ei);
            for (i, note) in el.event.notes().iter().enumerate() {
                if note.id.as_deref() == Some(note_id) {
                    let x = el.x + el.note_x_offsets.get(i).copied().unwrap_or(0.0) * notehead_w;
                    let pos = *el.note_positions.get(i)?;
                    return Some((x, pos));
                }
            }
        }
    }
    None
}

pub(super) fn resolve_note_span(
    ml: &MeasureLayout,
    start_id: &str,
    end_id: &str,
    sp: f64,
) -> Option<RenderedNoteSpan> {
    let (start_x, start_pos) = resolve_note_endpoint(ml, start_id, sp)?;
    let (end_x, end_pos) = resolve_note_endpoint(ml, end_id, sp)?;
    Some(RenderedNoteSpan {
        min_x: start_x.min(end_x),
        top_pos: start_pos.min(end_pos),
        bottom_pos: start_pos.max(end_pos),
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn render_arpeggio_span(
    dl: &mut DisplayList,
    span: RenderedNoteSpan,
    direction: Option<crate::model::ArpeggioDirection>,
    arrow: bool,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    font_size: f64,
    rotation: f64,
    extra_left: f64,
) {
    let top_y = staff_y + (span.top_pos - 0.5) * sp * 0.5;
    let bottom_y = staff_y + (span.bottom_pos + 0.5) * sp * 0.5;
    let desired_height = bottom_y - top_y;

    if desired_height <= 0.0 {
        return;
    }

    let glyph_x = span.min_x - config.arpeggio_offset * sp - extra_left;
    let is_down = matches!(direction, Some(crate::model::ArpeggioDirection::Down));
    let glyphs = arpeggio_glyphs_for(direction, arrow);
    let seg_advance = glyphs.segment_width * sp;
    let arrow_advance = glyphs.terminal_width * sp;
    let arrow_height = if glyphs.terminal.is_some() {
        arrow_advance
    } else {
        0.0
    };
    let body_height = desired_height - arrow_height;
    let num_segments = if body_height > 0.0 {
        (body_height / seg_advance).ceil() as usize
    } else {
        1
    };

    if is_down {
        let mut cur_y = bottom_y;
        if let Some(arrow_cp) = glyphs.terminal {
            dl.glyph_rotated(
                glyph_x, cur_y, arrow_cp, "Bravura", font_size, "#000000", rotation,
            );
            cur_y -= arrow_advance;
        }
        for _ in 0..num_segments {
            if cur_y < top_y - seg_advance * 0.5 {
                break;
            }
            dl.glyph_rotated(
                glyph_x,
                cur_y,
                glyphs.segment,
                "Bravura",
                font_size,
                "#000000",
                rotation,
            );
            cur_y -= seg_advance;
        }
    } else {
        let mut cur_y = bottom_y;
        let segments_end_y = if glyphs.terminal.is_some() {
            top_y + arrow_advance
        } else {
            top_y
        };
        for _ in 0..num_segments {
            if cur_y < segments_end_y - seg_advance * 0.5 {
                break;
            }
            dl.glyph_rotated(
                glyph_x,
                cur_y,
                glyphs.segment,
                "Bravura",
                font_size,
                "#000000",
                rotation,
            );
            cur_y -= seg_advance;
        }
        if let Some(arrow_cp) = glyphs.terminal {
            dl.glyph_rotated(
                glyph_x, cur_y, arrow_cp, "Bravura", font_size, "#000000", rotation,
            );
        }
    }
}

pub(super) fn arpeggio_glyphs_for(
    direction: Option<crate::model::ArpeggioDirection>,
    arrow: bool,
) -> smufl::ArpeggioGlyphs {
    let is_down = matches!(direction, Some(crate::model::ArpeggioDirection::Down));
    smufl::ArpeggioGlyphs {
        segment: if is_down {
            smufl::WIGGLE_ARPEGGIATO_DOWN
        } else {
            smufl::WIGGLE_ARPEGGIATO_UP
        },
        segment_width: smufl::WIGGLE_ARPEGGIATO_SEGMENT_WIDTH,
        terminal: if arrow {
            Some(if is_down {
                smufl::WIGGLE_ARPEGGIATO_DOWN_ARROW
            } else {
                smufl::WIGGLE_ARPEGGIATO_UP_ARROW
            })
        } else {
            None
        },
        terminal_width: if arrow {
            smufl::WIGGLE_ARPEGGIATO_ARROW_WIDTH
        } else {
            0.0
        },
    }
}

pub(super) fn render_non_arpeggio_span(
    dl: &mut DisplayList,
    span: RenderedNoteSpan,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    extra_left: f64,
) {
    let top_y = staff_y + (span.top_pos - 0.5) * sp * 0.5;
    let bottom_y = staff_y + (span.bottom_pos + 0.5) * sp * 0.5;
    if bottom_y <= top_y {
        return;
    }
    let x = span.min_x - config.arpeggio_offset * sp - extra_left;
    let tick = 0.45 * sp;
    let width = config.stem_width * sp;
    dl.push(RenderCommand::DrawLine {
        x1: x,
        y1: top_y,
        x2: x,
        y2: bottom_y,
        width,
        color: "#000000".into(),
    });
    dl.push(RenderCommand::DrawLine {
        x1: x,
        y1: top_y,
        x2: x + tick,
        y2: top_y,
        width,
        color: "#000000".into(),
    });
    dl.push(RenderCommand::DrawLine {
        x1: x,
        y1: bottom_y,
        x2: x + tick,
        y2: bottom_y,
        width,
        color: "#000000".into(),
    });
}
