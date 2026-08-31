#![allow(unused_imports)]

use super::super::arena::EventArena;
use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_events::{ArticCategory, ArticGlyph};
use super::super::render_geometry::*;
use super::super::resolve::*;
use super::super::slurs::{EndpointArticulationRelation, SlurParticipationMap, SlurRole, SlurSide};
use super::super::spacing::*;
use super::super::types::*;
use super::arpeggios::*;
use super::fermatas_trills_ornaments::*;
use super::fingerings::*;
use super::tremolo_breath::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

pub(super) fn glyph_vertical_offsets_half_spaces(codepoint: u32) -> (f64, f64) {
    let (_, yoff, _, h) = smufl::glyph_bbox(codepoint);
    (yoff * 2.0, (yoff + h) * 2.0)
}

fn explicit_articulation_place_below(markings: &crate::model::event::Markings) -> Option<bool> {
    let orientations = [
        markings.staccato.as_ref().and_then(|m| m.orient.as_ref()),
        markings.tenuto.as_ref().and_then(|m| m.orient.as_ref()),
        markings.accent.as_ref().and_then(|m| m.orient.as_ref()),
        markings
            .strong_accent
            .as_ref()
            .and_then(|m| m.orient.as_ref()),
        markings
            .staccatissimo
            .as_ref()
            .and_then(|m| m.orient.as_ref()),
        markings
            .staccatissimo_wedge
            .as_ref()
            .and_then(|m| m.orient.as_ref()),
        markings.spiccato.as_ref().and_then(|m| m.orient.as_ref()),
        markings
            .soft_accent
            .as_ref()
            .and_then(|m| m.orient.as_ref()),
        markings.stress.as_ref().and_then(|m| m.orient.as_ref()),
        markings.unstress.as_ref().and_then(|m| m.orient.as_ref()),
    ];
    orientations
        .into_iter()
        .flatten()
        .find_map(|orient| match orient {
            Orientation::Above => Some(false),
            Orientation::Below => Some(true),
            Orientation::Auto => None,
        })
}

/// Collect articulation glyphs in stacking order (closest to notehead first).
/// When two articulations form a ligature (e.g. accent + staccato), they
/// collapse into a single combo glyph that replaces both individuals.
pub(crate) fn collect_articulation_glyphs(
    markings: &crate::model::event::Markings,
    marcato_category: ArticCategory,
) -> Vec<ArticGlyph> {
    let has_staccato = markings.staccato.is_some();
    let has_tenuto = markings.tenuto.is_some();
    let has_accent = markings.accent.is_some();
    let has_marcato = markings.strong_accent.is_some();

    let combo_marcato_staccato = has_marcato && has_staccato && !has_tenuto && !has_accent;
    let combo_marcato_tenuto = has_marcato && has_tenuto && !has_staccato && !has_accent;
    let combo_accent_staccato = has_accent && has_staccato && !has_marcato && !has_tenuto;
    let combo_tenuto_staccato = has_tenuto && has_staccato && !has_accent && !has_marcato;
    let combo_tenuto_accent = has_tenuto && has_accent && !has_staccato && !has_marcato;

    let mut glyphs: Vec<ArticGlyph> = Vec::new();

    if combo_marcato_staccato {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_MARCATO_STACCATO_ABOVE,
            name: "strongAccent.staccato",
            below: smufl::ARTIC_MARCATO_STACCATO_BELOW,
            category: marcato_category,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Outside,
        });
    } else if combo_marcato_tenuto {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_MARCATO_TENUTO_ABOVE,
            name: "strongAccent.tenuto",
            below: smufl::ARTIC_MARCATO_TENUTO_BELOW,
            category: marcato_category,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Outside,
        });
    } else if combo_accent_staccato {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_ACCENT_STACCATO_ABOVE,
            name: "accent.staccato",
            below: smufl::ARTIC_ACCENT_STACCATO_BELOW,
            category: ArticCategory::CloseToNote,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Outside,
        });
    } else if combo_tenuto_staccato {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_TENUTO_STACCATO_ABOVE,
            name: "tenuto.staccato",
            below: smufl::ARTIC_TENUTO_STACCATO_BELOW,
            category: ArticCategory::CloseToNote,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Inside,
        });
    } else if combo_tenuto_accent {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_TENUTO_ACCENT_ABOVE,
            name: "tenuto.accent",
            below: smufl::ARTIC_TENUTO_ACCENT_BELOW,
            category: ArticCategory::CloseToNote,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Outside,
        });
    } else {
        if has_staccato {
            glyphs.push(ArticGlyph {
                above: smufl::ARTIC_STACCATO_ABOVE,
                name: "staccato",
                below: smufl::ARTIC_STACCATO_BELOW,
                category: ArticCategory::CloseToNote,
                is_staccato: true,
                is_accent: false,
                endpoint_relation: EndpointArticulationRelation::Inside,
            });
        }
        if has_tenuto {
            glyphs.push(ArticGlyph {
                above: smufl::ARTIC_TENUTO_ABOVE,
                name: "tenuto",
                below: smufl::ARTIC_TENUTO_BELOW,
                category: ArticCategory::CloseToNote,
                is_staccato: false,
                is_accent: false,
                endpoint_relation: EndpointArticulationRelation::Inside,
            });
        }
        if has_accent {
            glyphs.push(ArticGlyph {
                above: smufl::ARTIC_ACCENT_ABOVE,
                name: "accent",
                below: smufl::ARTIC_ACCENT_BELOW,
                category: ArticCategory::CloseToNote,
                is_staccato: false,
                is_accent: true,
                endpoint_relation: EndpointArticulationRelation::Outside,
            });
        }
        if has_marcato {
            glyphs.push(ArticGlyph {
                above: smufl::ARTIC_MARCATO_ABOVE,
                name: "strongAccent",
                below: smufl::ARTIC_MARCATO_BELOW,
                category: marcato_category,
                is_staccato: false,
                is_accent: false,
                endpoint_relation: EndpointArticulationRelation::Outside,
            });
        }
    }

    // These articulations are never part of combos — always render individually.
    if markings.staccatissimo.is_some() {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_STACCATISSIMO_ABOVE,
            name: "staccatissimo",
            below: smufl::ARTIC_STACCATISSIMO_BELOW,
            category: marcato_category,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Outside,
        });
    }
    if markings.staccatissimo_wedge.is_some() {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_STACCATISSIMO_WEDGE_ABOVE,
            name: "staccatissimoWedge",
            below: smufl::ARTIC_STACCATISSIMO_WEDGE_BELOW,
            category: marcato_category,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Outside,
        });
    }
    if markings.spiccato.is_some() {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_STACCATISSIMO_STROKE_ABOVE,
            name: "spiccato",
            below: smufl::ARTIC_STACCATISSIMO_STROKE_BELOW,
            category: ArticCategory::CloseToNote,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Inside,
        });
    }
    if markings.soft_accent.is_some() && !combo_tenuto_accent {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_SOFT_ACCENT_ABOVE,
            name: "softAccent",
            below: smufl::ARTIC_SOFT_ACCENT_BELOW,
            category: ArticCategory::CloseToNote,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Outside,
        });
    }
    if markings.stress.is_some() {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_STRESS_ABOVE,
            name: "stress",
            below: smufl::ARTIC_STRESS_BELOW,
            category: ArticCategory::CloseToNote,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Outside,
        });
    }
    if markings.unstress.is_some() {
        glyphs.push(ArticGlyph {
            above: smufl::ARTIC_UNSTRESS_ABOVE,
            name: "unstress",
            below: smufl::ARTIC_UNSTRESS_BELOW,
            category: ArticCategory::CloseToNote,
            is_staccato: false,
            is_accent: false,
            endpoint_relation: EndpointArticulationRelation::Inside,
        });
    }

    glyphs
}

/// Render close-to-note articulations (staccato, tenuto, accent, etc.)
/// stacking outward from the notehead or stem tip.
///
/// **Boundary slur events**: tall articulations (accent /
/// soft-accent / stress) sit OUTSIDE the slur curve at boundaries so the
/// slur tip clears them. Dot-shaped articulations (staccato, staccatissimo,
/// tenuto) sit INSIDE the slur even at boundaries — they tuck between
/// notehead and slur tip. Staccatissimo follows the tall-articulation rule:
/// outside at boundaries, inside at interior events, but never inside the staff.
///
/// Push distance per("first clear stave-space beyond the
/// stem [/slur tip]"): an extra ~1 sp past the slur tip combined with
/// `snap_to_space` reliably jumps the anchor into the next clear space.
///
/// Returns `(cur_pos, prev_far_edge)` so the caller can chain
/// Pass 2 (staff-anchored) and bow-direction passes.
#[allow(clippy::too_many_arguments)]
pub(super) fn render_close_to_note_articulations(
    dl: &mut DisplayList,
    close_glyphs: &[&ArticGlyph],
    has_staccato_accent: bool,
    has_stem: bool,
    stem_up: bool,
    slur_role: Option<SlurRole>,
    use_slur_side: bool,
    place_below: bool,
    top_pos: f64,
    bottom_pos: f64,
    stem_tip_pos: f64,
    config: &LayoutConfig,
    sp: f64,
    min_gap: f64,
    notehead_center_x: f64,
    staff_y: f64,
    glyph_size: f64,
    element_id_str: &str,
) -> (f64, Option<f64>) {
    // Any "tall" articulation present (accent, marcato, soft-accent, stress,
    // and combos containing them). At a slur boundary these sit *outside*
    // the slur curve and need the extra half-space push past the slur tip.
    let has_outside_glyph = close_glyphs
        .iter()
        .any(|glyph| glyph.endpoint_relation == EndpointArticulationRelation::Outside);

    // Slope-aware extra clearance at the boundary: tiny residual bump
    // (~0.10 hs per pitch step) capped at 0.5 hs so very steep slurs get
    // a hair of extra clearance, but flat/moderate slurs don't.
    let slope_extra: f64 = match slur_role {
        Some(r) if r.is_boundary && use_slur_side => {
            if let Some(partner_top) = r.partner_top_pos {
                // `top_pos` is the chord's min note position (same as the old
                // local recompute over `el.note_positions`).
                let my_top = top_pos;
                if my_top.is_finite() {
                    let delta = match r.side {
                        SlurSide::Above => partner_top - my_top,
                        SlurSide::Below => my_top - partner_top,
                    };
                    if delta > 0.0 {
                        (delta * 0.10).min(0.5)
                    } else {
                        0.0
                    }
                } else {
                    0.0
                }
            } else {
                0.0
            }
        }
        _ => 0.0,
    };
    let boundary_extra: f64 = match slur_role {
        Some(r) if r.is_boundary && has_outside_glyph && use_slur_side => 1.0 + slope_extra,
        _ => 0.0,
    };

    // Per-note clearance: `artic_distance_head` (0.5 sp) is the gap from the
    // notehead EDGE to the articulation centre; add `notehead_ry` to step out
    // from the notehead centre line to its edge.
    let head_offset = (config.artic_distance_head + config.notehead_ry) * 2.0;

    let mut cur_pos = if place_below {
        let from_head = bottom_pos + head_offset + boundary_extra;
        let from_stem = if has_stem && !stem_up {
            stem_tip_pos + config.artic_distance_stem * 2.0
        } else {
            from_head
        };
        let start = from_head.max(from_stem);
        if start <= 8.0 {
            snap_to_space(start, true)
        } else {
            start
        }
    } else {
        let from_head = top_pos - head_offset - boundary_extra;
        let from_stem = if has_stem && stem_up {
            stem_tip_pos - config.artic_distance_stem * 2.0
        } else {
            from_head
        };
        let start = from_head.min(from_stem);
        if start >= 0.0 {
            snap_to_space(start, false)
        } else {
            start
        }
    };

    let mut prev_far_edge: Option<f64> = None;
    let anchor_edge = cur_pos;

    for g in close_glyphs {
        let codepoint = if place_below { g.below } else { g.above };
        let (glyph_top_off, glyph_bottom_off) = glyph_vertical_offsets_half_spaces(codepoint);

        let mut effective_gap = min_gap;
        if has_staccato_accent && (g.is_staccato || g.is_accent) {
            effective_gap -= config.artic_staccato_accent_kern * 2.0;
            if effective_gap < 1.0 {
                effective_gap = 1.0;
            }
        }

        if place_below {
            let desired_top = match prev_far_edge {
                Some(prev_bottom) => prev_bottom + effective_gap,
                None => anchor_edge,
            };
            cur_pos = desired_top - glyph_top_off;
            if cur_pos <= 8.0 {
                cur_pos = snap_glyph_to_space(cur_pos, glyph_top_off, glyph_bottom_off, true);
            }
        } else {
            let desired_bottom = match prev_far_edge {
                Some(prev_top) => prev_top - effective_gap,
                None => anchor_edge,
            };
            cur_pos = desired_bottom - glyph_bottom_off;
            if cur_pos >= 0.0 {
                cur_pos = snap_glyph_to_space(cur_pos, glyph_top_off, glyph_bottom_off, false);
            }
        }
        if is_staccatissimo_codepoint(codepoint) {
            cur_pos =
                keep_glyph_outside_staff(cur_pos, glyph_top_off, glyph_bottom_off, place_below);
        }

        let artic_w = smufl::articulation_width(codepoint) * sp;
        let artic_x = notehead_center_x - artic_w * 0.5;
        let y = staff_y + cur_pos * sp * 0.5;
        dl.push_tagged(
            RenderCommand::DrawGlyph {
                x: artic_x,
                y,
                codepoint,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            },
            element_id::articulation(element_id_str, g.name),
        );

        if place_below {
            prev_far_edge = Some(cur_pos + glyph_bottom_off);
        } else {
            prev_far_edge = Some(cur_pos + glyph_top_off);
        }
    }

    (cur_pos, prev_far_edge)
}

/// Render staff-anchored articulations (marcato, ornaments) stacked outward
/// from the staff edge or from the prior Pass 1 stack.
///
/// **Slur policy (standard engraving)**: marcato is *always* outside the slur. When this
/// event participates in any slur (boundary or interior), bump the
/// staff-anchored stack out far enough (~2.5 sp) to clear the typical slur
/// peak so the slur arc passes underneath the marcato/staff-anchored glyphs.
///
/// Returns `prev_far_edge` after placing all staff-anchored
/// glyphs, so the caller can chain the bow-direction pass.
#[allow(clippy::too_many_arguments)]
pub(super) fn render_staff_anchored_articulations(
    dl: &mut DisplayList,
    staff_glyphs: &[&ArticGlyph],
    close_glyphs_empty: bool,
    in_slur: bool,
    mut cur_pos: f64,
    mut prev_far_edge: Option<f64>,
    place_below: bool,
    top_pos: f64,
    bottom_pos: f64,
    config: &LayoutConfig,
    sp: f64,
    min_gap: f64,
    notehead_center_x: f64,
    staff_y: f64,
    glyph_size: f64,
    element_id_str: &str,
) -> Option<f64> {
    if staff_glyphs.is_empty() {
        return prev_far_edge;
    }

    // Heuristic clearance for the slur arc (~2.5 sp = 5 half-spaces).
    let slur_clearance: f64 = if in_slur { 5.0 } else { 0.0 };

    if close_glyphs_empty {
        // Start from staff edge
        cur_pos = if place_below {
            let start = (bottom_pos + config.artic_distance_head * 2.0 + slur_clearance)
                .max(9.0 + slur_clearance);
            snap_to_space(start, true)
        } else {
            let start = (top_pos - config.artic_distance_head * 2.0 - slur_clearance)
                .min(-1.0 - slur_clearance);
            snap_to_space(start, false)
        };
    } else if slur_clearance > 0.0 {
        // Push the existing far-edge out so marcato sits past the slur arc.
        if let Some(prev) = prev_far_edge.as_mut() {
            if place_below {
                *prev += slur_clearance;
            } else {
                *prev -= slur_clearance;
            }
        }
    }

    for g in staff_glyphs {
        let codepoint = if place_below { g.below } else { g.above };
        let artic_w = smufl::articulation_width(codepoint) * sp;
        let (glyph_top_off, glyph_bottom_off) = glyph_vertical_offsets_half_spaces(codepoint);

        if place_below {
            let desired_top = match prev_far_edge {
                Some(prev_bottom) => prev_bottom + min_gap,
                None => cur_pos + glyph_top_off,
            };
            cur_pos = desired_top - glyph_top_off;
            if cur_pos <= 8.0 {
                cur_pos = snap_glyph_to_space(cur_pos, glyph_top_off, glyph_bottom_off, true);
            }
        } else {
            let desired_bottom = match prev_far_edge {
                Some(prev_top) => prev_top - min_gap,
                None => cur_pos + glyph_bottom_off,
            };
            cur_pos = desired_bottom - glyph_bottom_off;
            if cur_pos >= 0.0 {
                cur_pos = snap_glyph_to_space(cur_pos, glyph_top_off, glyph_bottom_off, false);
            }
        }
        cur_pos = keep_glyph_outside_staff(cur_pos, glyph_top_off, glyph_bottom_off, place_below);

        let artic_x = notehead_center_x - artic_w * 0.5;
        let y = staff_y + cur_pos * sp * 0.5;
        dl.push_tagged(
            RenderCommand::DrawGlyph {
                x: artic_x,
                y,
                codepoint,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            },
            element_id::articulation(element_id_str, g.name),
        );

        if place_below {
            prev_far_edge = Some(cur_pos + glyph_bottom_off);
        } else {
            prev_far_edge = Some(cur_pos + glyph_top_off);
        }
    }

    prev_far_edge
}

/// Render bow-direction marking (up-bow / down-bow) as an outside-staff glyph.
///
/// Bow markings always sit *outside* the staff (never near the notehead),
/// matching industry-standard engravers convention. Default placement is above; the
/// MNX `orient: "below"` flips it. Clearance is taken from the furthest of
/// (staff edge, notehead, stem tip if on the bow side) plus any
/// already-placed articulation stack, with 1 sp of breathing room.
///
/// Ref: <https://w3c-cg.github.io/mnx/docs/mnx-reference/objects/bow-direction/>
#[allow(clippy::too_many_arguments)]
pub(super) fn render_bow_direction(
    dl: &mut DisplayList,
    markings: &crate::model::event::Markings,
    stem_up: bool,
    staff_y: f64,
    sp: f64,
    _config: &LayoutConfig,
    element_id_str: &str,
    place_below: bool,
    top_pos: f64,
    bottom_pos: f64,
    stem_tip_pos: f64,
    notehead_center_x: f64,
    glyph_size: f64,
    prev_far_edge: Option<f64>,
) {
    let Some(bd) = markings.bow_direction.as_ref() else {
        return;
    };
    use crate::model::{Orientation, UpDown};
    let glyph = match bd.direction {
        UpDown::Up => smufl::STRINGS_UP_BOW,
        UpDown::Down => smufl::STRINGS_DOWN_BOW,
    };
    let bow_below = matches!(bd.orient, Some(Orientation::Below));
    let (glyph_top_off, glyph_bottom_off) = glyph_vertical_offsets_half_spaces(glyph);
    let breathing_room = 2.0_f64;
    let bow_pos = if bow_below {
        let from_staff = 8.0_f64;
        let from_notes = bottom_pos;
        let from_stem = if !stem_up {
            stem_tip_pos
        } else {
            f64::NEG_INFINITY
        };
        let furthest = from_staff.max(from_notes).max(from_stem);
        let from_stack = match prev_far_edge {
            Some(prev_bottom) if place_below => prev_bottom + breathing_room,
            _ => f64::NEG_INFINITY,
        };
        let desired_top = (furthest + breathing_room).max(from_stack);
        desired_top - glyph_top_off
    } else {
        let from_staff = 0.0_f64;
        let from_notes = top_pos;
        let from_stem = if stem_up { stem_tip_pos } else { f64::INFINITY };
        let furthest = from_staff.min(from_notes).min(from_stem);
        let from_stack = match prev_far_edge {
            Some(prev_top) if !place_below => prev_top - breathing_room,
            _ => f64::INFINITY,
        };
        let desired_bottom = (furthest - breathing_room).min(from_stack);
        desired_bottom - glyph_bottom_off
    };
    let artic_w = smufl::articulation_width(glyph) * sp;
    let artic_x = notehead_center_x - artic_w * 0.5;
    let y = staff_y + bow_pos * sp * 0.5;
    dl.push_tagged(
        RenderCommand::DrawGlyph {
            x: artic_x,
            y,
            codepoint: glyph,
            font: "Bravura".into(),
            size: glyph_size,
            color: "#000000".into(),
            rotation: 0.0,
        },
        element_id::articulation(element_id_str, "bowDirection"),
    );
}

/// Render articulation markings for an event using a 3-pass approach.
///
/// **Pass 1** — Close-to-note articulations (staccato, tenuto, accent):
///   direction from stem side in multi-voice, opposite stem in single voice;
///   snap to staff-line gaps; propertyDistanceStem ~0.5sp, propertyDistanceHead ~0.5sp.
///
/// **Pass 2** — Staff-anchored articulations (marcato, staccatissimo) stacked
///   outward from the staff edge with articulationMinDistance.
///
/// **Pass 3** — (Stub) Adjust articulations outside slur arc.
pub(crate) fn render_articulations(
    dl: &mut DisplayList,
    events: &EventArena,
    ei: usize,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    element_id: &str,
    slur_map: Option<&SlurParticipationMap>,
    voice_index: usize,
) {
    let event = events.event(ei);
    let has_stem = event.duration.base.has_stem();
    let stem_up = events.stem_up(ei);
    let note_positions = events.note_positions(ei);
    let markings = match &event.markings {
        Some(m) => m,
        None => return,
    };
    let has_continuing_tie = event.notes().iter().any(|note| {
        note.ties.as_deref().is_some_and(|ties| {
            ties.iter()
                .any(|tie| tie.lv != Some(true) && tie.target.is_some())
        })
    });

    // Look up slur participation up front so we can choose the right
    // category/flags for "tall" articulations (marcato in particular).
    // Per/ industry-standard engravers: when a slur is present,
    // marcato follows the *accent* rule — boundary marcatos sit outside
    // the slur, interior marcatos sit inside the slur, beside each
    // notehead. Outside a slur, marcato keeps its uniform staff-anchored
    // row above the staff.
    let slur_role: Option<SlurRole> = events
        .id(ei)
        .and_then(|id| slur_map.and_then(|m| m.get(id).copied()));
    let in_slur = slur_role.is_some();
    let marcato_category = if in_slur {
        ArticCategory::CloseToNote
    } else {
        ArticCategory::StaffAnchored
    };

    // Collect articulation glyphs in stacking order (closest to notehead first).
    // Combos (accent+staccato, marcato+tenuto, …) collapse into single ligature
    // glyphs when both constituents are present. See `collect_articulation_glyphs`.
    let glyphs = collect_articulation_glyphs(markings, marcato_category);

    if glyphs.is_empty() && markings.bow_direction.is_none() {
        return;
    }
    if note_positions.is_empty() {
        return;
    }

    let glyph_size = 4.0 * sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let notehead_center_x = events.x(ei) + notehead_w * 0.5;

    let top_pos = note_positions.iter().cloned().fold(f64::INFINITY, f64::min);
    let bottom_pos = note_positions
        .iter()
        .cloned()
        .fold(f64::NEG_INFINITY, f64::max);

    // Determine articulation placement side.
    // Multi-voice: articulations are forced to the voice's OUTER side by voice
    // parity (voice 1/3/5 above, voice 2/4/6 below) — the same rule slurs use
    // (see `decide_curve_direction`). This co-locates each voice's
    // articulations with its slurs on the stem-free outer side, instead of
    // squishing them into the middle between the voices. Using parity (not stem
    // direction) keeps them outside even when a voice's stem is forced opposite
    // its parity.
    // Single voice: opposite stem (current convention).
    // **Slur override (standard engraving)**: when this event participates in a slur, the
    // articulation side follows the slur, not the parity/stem default.
    // (slur_role was looked up earlier to choose the marcato category.)
    let is_multi_voice = events.num_voices(ei) > 1;
    //: when a slur spans notes with mixed stem directions,
    // articulations go *beside each notehead* (per-stem), not on the slur
    // side. The `mixed_stems` flag on the role marks this case so we fall
    // back to the default rule below.
    let use_slur_side = slur_role.is_some_and(|r| !r.mixed_stems);
    // Cross-staff override: a staff that receives a cross-staff voice gives its
    // native voice a forced outer side (set by the cross-staff fix) so the
    // articulation co-locates with that voice rather than landing between the
    // native and arriving voices. See `cross_staff_flip_native_stems`.
    let cross_staff_force = events.artic_force_below(ei);
    let automatic_place_below = match slur_role {
        Some(role) if use_slur_side => matches!(role.side, SlurSide::Below),
        _ => {
            if let Some(forced) = cross_staff_force {
                forced
            } else if is_multi_voice {
                // 0-based parity: voice 0 (1st) → above, voice 1 (2nd) → below.
                voice_index % 2 == 1
            } else {
                stem_up
            }
        }
    };
    // Explicit MNX orientation moves the articulation stack to that side. Combo
    // glyphs share one stack, so the first explicit constituent is authoritative.
    let place_below = explicit_articulation_place_below(markings).unwrap_or(automatic_place_below);
    // Standard engraving practice: a continuing tie and a close articulation
    // on the same stem-opposite side need separate vertical lanes. Move the
    // articulation outward by half a staff space; the tie remains close to the
    // notehead and can therefore stay flatter.
    let tie_lane_extra = if has_continuing_tie && !is_multi_voice && place_below == stem_up {
        1.0
    } else {
        0.0
    };

    // Compute the stem tip position (staff-position units) for distance-from-stem.
    let stem_tip_pos = if stem_up {
        top_pos - config.stem_length * 2.0
    } else {
        bottom_pos + config.stem_length * 2.0
    };

    // Separate glyphs into pass-1 (close-to-note) and pass-2 (staff-anchored).
    let close_glyphs: Vec<&ArticGlyph> = glyphs
        .iter()
        .filter(|g| g.category == ArticCategory::CloseToNote)
        .collect();
    let staff_glyphs: Vec<&ArticGlyph> = glyphs
        .iter()
        .filter(|g| g.category == ArticCategory::StaffAnchored)
        .collect();

    // Check for staccato+accent kerning: both present means we reduce spacing.
    let has_staccato_accent =
        glyphs.iter().any(|g| g.is_staccato) && glyphs.iter().any(|g| g.is_accent);

    // ── Pass 1: close-to-note articulations ─────────────────────────
    let min_gap = config.artic_min_distance * 2.0;
    let (cur_pos, prev_far_edge) = render_close_to_note_articulations(
        dl,
        &close_glyphs,
        has_staccato_accent,
        has_stem,
        stem_up,
        slur_role,
        use_slur_side,
        place_below,
        top_pos - if place_below { 0.0 } else { tie_lane_extra },
        bottom_pos + if place_below { tie_lane_extra } else { 0.0 },
        stem_tip_pos,
        config,
        sp,
        min_gap,
        notehead_center_x,
        staff_y,
        glyph_size,
        element_id,
    );

    // ── Pass 2: staff-anchored articulations ────────────────────────
    let prev_far_edge = render_staff_anchored_articulations(
        dl,
        &staff_glyphs,
        close_glyphs.is_empty(),
        slur_role.is_some(),
        cur_pos,
        prev_far_edge,
        place_below,
        top_pos,
        bottom_pos,
        config,
        sp,
        min_gap,
        notehead_center_x,
        staff_y,
        glyph_size,
        element_id,
    );

    // ── Bow direction ──────────────────────────────────────────────
    render_bow_direction(
        dl,
        markings,
        stem_up,
        staff_y,
        sp,
        config,
        element_id,
        place_below,
        top_pos,
        bottom_pos,
        stem_tip_pos,
        notehead_center_x,
        glyph_size,
        prev_far_edge,
    );

    // ── Slur-aware placement ────────────────────────────────────────
    // Slur side, boundary placement, and marcato/staff-anchored "outside slur"
    // policy are applied above via `slur_role` (standard engraving practice for
    // articulations and slurs). The slur arc itself is drawn afterwards in `render_slurs`,
    // which uses our recorded articulation bboxes as obstacles so it arches
    // *over* interior articulations.
}
