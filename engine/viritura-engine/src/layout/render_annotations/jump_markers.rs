//! Jump-marker rendering for segno, coda, fine, and jump instructions.

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::text_styles::{self, FontFamily};
use super::super::types::*;
use super::substrate_obstacles::{
    above_glyph_top_in_range, highest_point_in_measure, AboveGlyphBox,
};
use crate::model::JumpType;
use crate::render::smufl::smufl;
use crate::render::*;

#[path = "jump_markers/marker_text.rs"]
mod marker_text;

use marker_text::{GlyphMarker, RowAnchor};

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

    let marker_text = global.marker_text();

    // Render segno glyph (centered at measure start, after prefix)
    if global.segno.is_some() {
        let segno_x = ml.x + ml.prefix_width + 0.5 * sp;
        let (slot_offset, _, _, _) = smufl::glyph_bbox(smufl::SEGNO);
        marker_text::emit_glyph_marker(
            dl,
            GlyphMarker {
                codepoint: smufl::SEGNO,
                glyph_y,
                glyph_size,
                text_size,
                sp,
                anchor: RowAnchor::Start(segno_x + slot_offset * sp),
                text: marker_text.and_then(|text| text.segno.as_ref()),
                element_id: element_id::segno(mi),
            },
        );
    }

    // Render coda glyph. Unlike segno (a forward-referenced landing point that
    // opens new content), a "to Coda" mark closes out the material it's
    // attached to — it belongs with the previous bar's content, so it hugs the
    // trailing barline (right-aligned at measure end) rather than sitting
    // indented into this measure's own start.
    let coda_left = global.coda().map(|_| {
        marker_text::emit_glyph_marker(
            dl,
            GlyphMarker {
                codepoint: smufl::CODA,
                glyph_y,
                glyph_size,
                text_size,
                sp,
                anchor: RowAnchor::End(measure_right),
                text: marker_text.and_then(|text| text.coda.as_ref()),
                element_id: element_id::coda(mi),
            },
        )
    });

    // Render "fine" text (right-aligned at measure end)
    if global.fine.is_some() {
        let content =
            marker_text::compose_label("fine", marker_text.and_then(|text| text.fine.as_ref()));
        let baseline_y = text_y + baseline_offset;
        let eid = element_id::fine(mi);
        marker_text::emit_owned_text(
            dl,
            &content,
            measure_right,
            baseline_y,
            text_size,
            TextAlign::Right,
            &eid,
        );
        // Right-aligned, Alphabetic baseline: the box grows leftward from
        // `measure_right` and spans the cap band above the baseline down to it,
        // so the near-staff edge sits exactly `text_attach_gap` above the staff.
        let text_w = marker_text::text_width(&content, text_size);
        let text_height = marker_text::text_height(&content, text_size);
        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: eid,
            bbox: BoundingBox::new(
                measure_right - text_w,
                baseline_y - text_height,
                text_w,
                text_height,
            ),
        });
    }

    // Render jump text. A paired coda owns the trailing edge of the barline,
    // so the jump instruction occupies the space immediately to its left.
    if let Some(ref jump) = global.jump {
        let generated = match jump.jump_type {
            JumpType::Segno => "D.S.",
            JumpType::DsAlFine => "D.S. al Fine",
            JumpType::DsAlCoda => "D.S. al Coda",
            JumpType::DcAlCoda => "D.C. al Coda",
        };
        let content =
            marker_text::compose_label(generated, marker_text.and_then(|text| text.jump.as_ref()));
        let text_w = marker_text::text_width(&content, text_size);
        let text_height = marker_text::text_height(&content, text_size);
        let (text_x, align, bbox_x) = match coda_left {
            Some(coda_left) => {
                let text_right = coda_left - 0.5 * sp;
                (text_right - text_w, TextAlign::Left, text_right - text_w)
            }
            None => (measure_right, TextAlign::Right, measure_right - text_w),
        };
        let resting_baseline = text_y + baseline_offset * (text_height / (0.82 * text_size));
        let baseline_y = above_glyph_top_in_range(above_ink_boxes, bbox_x, bbox_x + text_w)
            .map_or(resting_baseline, |ink_top| {
                resting_baseline.min(ink_top - clearance)
            });
        let eid = element_id::jump(mi);
        marker_text::emit_owned_text(dl, &content, text_x, baseline_y, text_size, align, &eid);
        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: eid,
            bbox: BoundingBox::new(bbox_x, baseline_y - text_height, text_w, text_height),
        });
    }
}
