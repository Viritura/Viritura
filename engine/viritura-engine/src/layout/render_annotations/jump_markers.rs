//! Jump-marker rendering for segno, coda, fine, and jump instructions.

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::text_styles::{self, FontFamily};
use super::super::types::*;
use super::substrate_obstacles::{
    above_glyph_top_in_range, glyph_screen_bbox, highest_point_in_measure, AboveGlyphBox,
};
use crate::model::JumpType;
use crate::render::smufl::smufl;
use crate::render::*;

/// Render jump markers (segno signs, coda signs, fine, D.S., D.S. al Coda text) above the staff.
///
/// - **Segno**: SMuFL glyph centered above the staff at the marker's position
/// - **Coda**: SMuFL glyph centered above the staff at the marker's position
/// - **Fine**: Italic "fine" text, right-aligned at the measure end
/// - **Jump**: "D.S.", "D.S. al Fine", "D.S. al Coda", or "D.C. al Coda" text, right-aligned
///   unless a coda shares its barline, in which case it sits to the coda's left
pub(crate) fn render_jump_markers(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    above_ink_boxes: &[AboveGlyphBox],
) {
    let global = &ml.resolved.global;
    let mi = ml.resolved.index;

    // SMuFL segno/coda glyph at staff size
    let glyph_size = 3.0 * sp;
    // Direction text (Fine, D.S.) — sized to match staff labels
    let text_size = 2.0 * sp; // ~10pt = 2.0sp (standard engraving default)
    let measure_right =
        ml.x + ml.prefix_width + super::super::render_barlines::rhythmic_content_width(ml, sp);
    // Anchor gaps + lift clearance from the placement table so they're visible
    // in the debug overlay and tunable via `placementDefaults.json` rather than
    // baked-in literals. Segno/coda (glyphs) and fine/D.S. (text) share this
    // function: the glyph anchors by `segno.attachGap`, the text by
    // `fine.attachGap` (jump matches), both lifting by `segno.padding.vertical`.
    let glyph_attach_gap = config.placement.resolve(ElementKind::Segno).attach_gap;
    let clearance = config
        .placement
        .resolve(ElementKind::Segno)
        .padding
        .vertical
        * sp;
    let text_attach_gap = config.placement.resolve(ElementKind::Fine).attach_gap;

    // Collision-aware Y: find highest element in the whole measure
    let highest = highest_point_in_measure(ml, staff_y, sp, config.stem_length);
    // Distance from the `Middle` anchor down to the alphabetic baseline. The
    // text markers render `Alphabetic`, so their ink baseline (= ink bottom; no
    // descenders) lands exactly `text_attach_gap` above the staff — edge-honest
    // for the overlay. Font-metric seam lives in `text_styles`.
    let baseline_offset = text_styles::baseline_offset_from_middle(FontFamily::Serif, text_size);
    // Minimum positions (when nothing protrudes above the staff). The glyph
    // origin sits at `glyph_attach_gap`; the text Middle anchor sits
    // `baseline_offset` above its baseline so the baseline lands at
    // `text_attach_gap`.
    let min_glyph_y = staff_y - glyph_attach_gap * sp;
    let min_text_y = staff_y - text_attach_gap * sp - baseline_offset;
    // Push below highest element; glyph center needs ~1.5sp clearance. The text
    // lift clears the obstacle by `clearance` measured to the baseline.
    let glyph_y = min_glyph_y.min(highest - clearance - glyph_size * 0.3);
    let text_y = min_text_y.min(highest - clearance - baseline_offset);

    // Render segno glyph (centered at measure start, after prefix)
    if let Some(ref _segno) = global.segno {
        let segno_x = ml.x + ml.prefix_width + 0.5 * sp;
        dl.push_tagged(
            RenderCommand::DrawGlyph {
                x: segno_x,
                y: glyph_y,
                codepoint: smufl::SEGNO,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            },
            element_id::segno(mi),
        );
        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: element_id::segno(mi),
            bbox: glyph_screen_bbox(segno_x, glyph_y, smufl::SEGNO, glyph_size).to_bbox(),
        });
    }

    // Render coda glyph. Unlike segno (a forward-referenced landing point that
    // opens new content), a "to Coda" mark closes out the material it's
    // attached to — it belongs with the previous bar's content, so it hugs the
    // trailing barline (right-aligned at measure end) rather than sitting
    // indented into this measure's own start.
    if let Some(_coda) = global.coda() {
        let (bx, _, bw, _) = smufl::glyph_bbox(smufl::CODA);
        let coda_x = measure_right - (bx + bw) * sp;
        dl.push_tagged(
            RenderCommand::DrawGlyph {
                x: coda_x,
                y: glyph_y,
                codepoint: smufl::CODA,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            },
            element_id::coda(mi),
        );
        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: element_id::coda(mi),
            bbox: glyph_screen_bbox(coda_x, glyph_y, smufl::CODA, glyph_size).to_bbox(),
        });
    }

    // Render "fine" text (right-aligned at measure end)
    if global.fine.is_some() {
        let baseline_y = text_y + baseline_offset;
        dl.push_tagged(
            RenderCommand::DrawText {
                x: measure_right,
                y: baseline_y,
                text: "fine".into(),
                font: "serif italic".into(),
                size: text_size,
                color: "#000000".into(),
                align: TextAlign::Right,
                baseline: TextBaseline::Alphabetic,
            },
            element_id::fine(mi),
        );
        // Right-aligned, Alphabetic baseline: the box grows leftward from
        // `measure_right` and spans the cap band above the baseline down to it
        // (bottom = baseline; "fine" has no descenders), so the near-staff edge
        // sits exactly `text_attach_gap` above the staff. Track the
        // collision-shifted baseline. Width from the serif AFM table.
        let text_w = text_styles::text_width("fine", text_size, FontFamily::Serif, false);
        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: element_id::fine(mi),
            bbox: BoundingBox::new(
                measure_right - text_w,
                baseline_y - text_size * 0.82,
                text_w,
                text_size * 0.82,
            ),
        });
    }

    // Render jump text. A paired coda owns the trailing edge of the barline,
    // so the jump instruction occupies the space immediately to its left.
    if let Some(ref jump) = global.jump {
        let text = match jump.jump_type {
            JumpType::Segno => "D.S.".into(),
            JumpType::DsAlFine => "D.S. al Fine".into(),
            JumpType::DsAlCoda => "D.S. al Coda".into(),
            JumpType::DcAlCoda => "D.C. al Coda".into(),
        };
        let text: String = text;
        let text_w = text_styles::text_width(&text, text_size, FontFamily::Serif, false);
        let (text_x, align, bbox_x) = if global.coda().is_some() {
            let (_, _, coda_w, _) = smufl::glyph_bbox(smufl::CODA);
            let text_right = measure_right - coda_w * sp - 0.5 * sp;
            (text_right - text_w, TextAlign::Left, text_right - text_w)
        } else {
            (measure_right, TextAlign::Right, measure_right - text_w)
        };
        let baseline_y = above_glyph_top_in_range(above_ink_boxes, bbox_x, bbox_x + text_w)
            .map_or(text_y + baseline_offset, |ink_top| {
                (text_y + baseline_offset).min(ink_top - clearance)
            });
        dl.push_tagged(
            RenderCommand::DrawText {
                x: text_x,
                y: baseline_y,
                text,
                font: "serif italic".into(),
                size: text_size,
                color: "#000000".into(),
                align,
                baseline: TextBaseline::Alphabetic,
            },
            element_id::jump(mi),
        );
        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: element_id::jump(mi),
            bbox: BoundingBox::new(
                bbox_x,
                baseline_y - text_size * 0.82,
                text_w,
                text_size * 0.82,
            ),
        });
    }
}
