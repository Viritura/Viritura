#![allow(unused_imports)]

use super::*;
use serde::{Deserialize, Serialize};

mod assembly;
mod primitives;
mod shape_registry;

pub use shape_registry::classify_element_kind;

/// A complete display list for a page/system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayList {
    pub commands: Vec<RenderCommand>,
    pub width: f64,
    pub height: f64,
    /// Page layout information (empty if paging is not applied).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages: Vec<PageLayout>,
    /// Element IDs parallel to commands. Each entry maps a render command to
    /// a model path (e.g. "p0/m3/s0/ev1") for hit-testing and selection.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub element_ids: Vec<Option<String>>,
    /// Bounding boxes for logical elements (notes, rests, clefs, etc.).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub element_bboxes: Vec<ElementBBox>,
    /// Per-element shape registry — collision / engraving consumers query
    /// this instead of parsing render commands. See `ElementShape`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub element_shapes: Vec<ElementShape>,
    /// Bezier spine geometry for each emitted slur, keyed by element_id.
    /// Consumed by engrave mode to render drag handles without parsing
    /// `DrawFilledBezier` commands. See `SlurGeometry`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slur_geometries: Vec<SlurGeometry>,
    /// Measure layout bounds for cursor positioning and ruler display.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub measure_bounds: Vec<MeasureBounds>,
    /// Optional vertical-spacing debug sidecar. Populated only when
    /// `LayoutConfig.emit_layout_debug = true`. Used by the editor's
    /// spacing debug overlay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout_debug: Option<LayoutDebugInfo>,
    /// Page-turn warnings from the auto-page-break optimizer. Populated only
    /// when `LayoutConfig.page_turns.enabled = true` and the layout is paged.
    /// Each entry flags a physical page turn that lands somewhere awkward.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_turn_warnings: Option<Vec<PageTurnWarning>>,
}

/// A flagged physical page turn surfaced to the editor (serializable mirror of
/// the engine-internal `layout::page_turn::TurnWarning`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageTurnWarning {
    /// The turn lands at the boundary between this measure index and the next.
    pub boundary_measure: usize,
    /// One of `"tight"`, `"impossible"`, `"structural"`, `"fermata"`.
    pub kind: String,
    /// Available turn time in seconds.
    pub turn_seconds: f64,
}

impl DisplayList {
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            commands: Vec::new(),
            width,
            height,
            pages: Vec::new(),
            element_ids: Vec::new(),
            element_bboxes: Vec::new(),
            element_shapes: Vec::new(),
            slur_geometries: Vec::new(),
            measure_bounds: Vec::new(),
            layout_debug: None,
            page_turn_warnings: None,
        }
    }

    pub fn push(&mut self, cmd: RenderCommand) {
        self.commands.push(cmd);
        if !self.element_ids.is_empty() {
            self.element_ids.push(None);
        }
    }

    /// Push a render command tagged with an element ID for hit-testing.
    pub fn push_tagged(&mut self, cmd: RenderCommand, element_id: String) {
        // Backfill element_ids with None if this is the first tagged command
        if self.element_ids.is_empty() && !self.commands.is_empty() {
            self.element_ids.resize(self.commands.len(), None);
        }
        self.commands.push(cmd);
        self.element_ids.push(Some(element_id));
    }

    /// Tag an existing command at `idx` with an element ID (for post-hoc tagging).
    pub fn tag_command(&mut self, idx: usize, element_id: String) {
        if self.element_ids.is_empty() && !self.commands.is_empty() {
            self.element_ids.resize(self.commands.len(), None);
        }
        if idx < self.element_ids.len() {
            self.element_ids[idx] = Some(element_id);
        }
    }

    /// Check if a command at `idx` already has an element ID tag.
    pub fn is_tagged(&self, idx: usize) -> bool {
        idx < self.element_ids.len() && self.element_ids[idx].is_some()
    }

    /// Recolor all commands from index `start` to the end with `new_color`.
    pub fn recolor_range(&mut self, start: usize, new_color: &str) {
        for cmd in &mut self.commands[start..] {
            cmd.recolor(new_color);
        }
    }
}

#[cfg(test)]
mod translate_tests {
    use super::*;

    #[test]
    fn classify_element_kind_covers_known_suffixes() {
        use crate::layout::element_id;
        assert_eq!(
            classify_element_kind(&element_id::clef(0, 0)),
            ElementKind::Clef
        );
        assert_eq!(
            classify_element_kind(&element_id::key_sig(0, 0)),
            ElementKind::KeySig
        );
        assert_eq!(
            classify_element_kind(&element_id::time_sig(0)),
            ElementKind::TimeSig
        );
        assert_eq!(
            classify_element_kind(&element_id::barline(0)),
            ElementKind::Barline
        );
        assert_eq!(
            classify_element_kind(&element_id::tempo(0, 0)),
            ElementKind::Tempo
        );
        assert_eq!(
            classify_element_kind(&element_id::rehearsal(0)),
            ElementKind::RehearsalMark
        );
        assert_eq!(
            classify_element_kind(&element_id::measure_number(0)),
            ElementKind::MeasureNumber
        );
        assert_eq!(
            classify_element_kind(&element_id::expression(0, 0, 0)),
            ElementKind::Expression
        );
        assert_eq!(
            classify_element_kind(&element_id::chord_symbol(0, 0, 0)),
            ElementKind::ChordSymbol
        );
        assert_eq!(
            classify_element_kind(&element_id::ottava(0, 0, 0)),
            ElementKind::Ottava
        );
        assert_eq!(
            classify_element_kind(&element_id::tuplet(0, 0, 0, 0)),
            ElementKind::Tuplet
        );
        assert_eq!(
            classify_element_kind(&element_id::segno(0)),
            ElementKind::Segno
        );
        assert_eq!(
            classify_element_kind(&element_id::coda(0)),
            ElementKind::Coda
        );
        assert_eq!(
            classify_element_kind(&element_id::fine(0)),
            ElementKind::Fine
        );
        assert_eq!(
            classify_element_kind(&element_id::jump(0)),
            ElementKind::Jump
        );
        assert_eq!(
            classify_element_kind(&element_id::glissando("a", "b")),
            ElementKind::Glissando
        );
        assert_eq!(
            classify_element_kind(&element_id::ornament_bbox("p0/m0/s0/e1")),
            ElementKind::Ornament
        );
        // Bare event ids stay unclassified.
        assert_eq!(
            classify_element_kind(&element_id::event(0, 0, 0, "e1")),
            ElementKind::Other
        );
    }

    fn make_text_align() -> TextAlign {
        TextAlign::Left
    }
    fn make_text_baseline() -> TextBaseline {
        TextBaseline::Alphabetic
    }

    fn all_variants() -> Vec<RenderCommand> {
        vec![
            RenderCommand::DrawEllipse {
                cx: 1.0,
                cy: 2.0,
                rx: 3.0,
                ry: 4.0,
                angle: 0.0,
                filled: true,
                color: "#000".into(),
            },
            RenderCommand::DrawLine {
                x1: 1.0,
                y1: 2.0,
                x2: 5.0,
                y2: 6.0,
                width: 1.0,
                color: "#000".into(),
            },
            RenderCommand::DrawBezier {
                x1: 1.0,
                y1: 2.0,
                cx1: 3.0,
                cy1: 4.0,
                cx2: 5.0,
                cy2: 6.0,
                x2: 7.0,
                y2: 8.0,
                width: 1.0,
                color: "#000".into(),
            },
            RenderCommand::DrawQuadratic {
                x1: 1.0,
                y1: 2.0,
                cx: 3.0,
                cy: 4.0,
                x2: 5.0,
                y2: 6.0,
                width: 1.0,
                color: "#000".into(),
            },
            RenderCommand::DrawRect {
                x: 1.0,
                y: 2.0,
                w: 3.0,
                h: 4.0,
                color: "#000".into(),
            },
            RenderCommand::DrawCircle {
                cx: 1.0,
                cy: 2.0,
                r: 3.0,
                color: "#000".into(),
            },
            RenderCommand::DrawText {
                x: 1.0,
                y: 2.0,
                text: "t".into(),
                font: "f".into(),
                size: 10.0,
                color: "#000".into(),
                align: make_text_align(),
                baseline: make_text_baseline(),
            },
            RenderCommand::DrawGlyph {
                x: 1.0,
                y: 2.0,
                codepoint: 0xE000,
                font: "Bravura".into(),
                size: 10.0,
                color: "#000".into(),
                rotation: 0.0,
            },
            RenderCommand::DrawPolygon {
                points: vec![(1.0, 2.0), (3.0, 4.0), (5.0, 6.0)],
                color: "#000".into(),
            },
            RenderCommand::DrawFilledBezier {
                x1: 1.0,
                y1: 2.0,
                x2: 3.0,
                y2: 4.0,
                ocx1: 5.0,
                ocy1: 6.0,
                ocx2: 7.0,
                ocy2: 8.0,
                icx1: 9.0,
                icy1: 10.0,
                icx2: 11.0,
                icy2: 12.0,
                ix1: 1.0,
                iy1: 2.0,
                ix2: 3.0,
                iy2: 4.0,
                color: "#000".into(),
                line_style: 0,
            },
            RenderCommand::SetOpacity { opacity: 0.5 },
        ]
    }

    #[test]
    fn translate_in_place_shifts_each_variant_correctly() {
        for cmd in all_variants() {
            let original = cmd.clone();
            let mut shifted = cmd;
            shifted.translate_in_place(10.0, 20.0);
            match (original, shifted) {
                (
                    RenderCommand::DrawEllipse { cx: ox, cy: oy, .. },
                    RenderCommand::DrawEllipse { cx, cy, .. },
                ) => {
                    assert_eq!(cx, ox + 10.0);
                    assert_eq!(cy, oy + 20.0);
                }
                (
                    RenderCommand::DrawLine {
                        x1: ox1,
                        y1: oy1,
                        x2: ox2,
                        y2: oy2,
                        ..
                    },
                    RenderCommand::DrawLine { x1, y1, x2, y2, .. },
                ) => {
                    assert_eq!(x1, ox1 + 10.0);
                    assert_eq!(y1, oy1 + 20.0);
                    assert_eq!(x2, ox2 + 10.0);
                    assert_eq!(y2, oy2 + 20.0);
                }
                (
                    RenderCommand::DrawBezier {
                        x1: ox1,
                        y1: oy1,
                        cx1: ocx1,
                        cy1: ocy1,
                        cx2: ocx2,
                        cy2: ocy2,
                        x2: ox2,
                        y2: oy2,
                        ..
                    },
                    RenderCommand::DrawBezier {
                        x1,
                        y1,
                        cx1,
                        cy1,
                        cx2,
                        cy2,
                        x2,
                        y2,
                        ..
                    },
                ) => {
                    assert_eq!(x1, ox1 + 10.0);
                    assert_eq!(y1, oy1 + 20.0);
                    assert_eq!(cx1, ocx1 + 10.0);
                    assert_eq!(cy1, ocy1 + 20.0);
                    assert_eq!(cx2, ocx2 + 10.0);
                    assert_eq!(cy2, ocy2 + 20.0);
                    assert_eq!(x2, ox2 + 10.0);
                    assert_eq!(y2, oy2 + 20.0);
                }
                (
                    RenderCommand::DrawQuadratic {
                        x1: ox1,
                        y1: oy1,
                        cx: ocx,
                        cy: ocy,
                        x2: ox2,
                        y2: oy2,
                        ..
                    },
                    RenderCommand::DrawQuadratic {
                        x1,
                        y1,
                        cx,
                        cy,
                        x2,
                        y2,
                        ..
                    },
                ) => {
                    assert_eq!(x1, ox1 + 10.0);
                    assert_eq!(y1, oy1 + 20.0);
                    assert_eq!(cx, ocx + 10.0);
                    assert_eq!(cy, ocy + 20.0);
                    assert_eq!(x2, ox2 + 10.0);
                    assert_eq!(y2, oy2 + 20.0);
                }
                (
                    RenderCommand::DrawRect {
                        x: ox,
                        y: oy,
                        w: ow,
                        h: oh,
                        ..
                    },
                    RenderCommand::DrawRect { x, y, w, h, .. },
                ) => {
                    assert_eq!(x, ox + 10.0);
                    assert_eq!(y, oy + 20.0);
                    // size unchanged
                    assert_eq!(w, ow);
                    assert_eq!(h, oh);
                }
                (
                    RenderCommand::DrawCircle {
                        cx: ox,
                        cy: oy,
                        r: or,
                        ..
                    },
                    RenderCommand::DrawCircle { cx, cy, r, .. },
                ) => {
                    assert_eq!(cx, ox + 10.0);
                    assert_eq!(cy, oy + 20.0);
                    assert_eq!(r, or);
                }
                (
                    RenderCommand::DrawText { x: ox, y: oy, .. },
                    RenderCommand::DrawText { x, y, .. },
                ) => {
                    assert_eq!(x, ox + 10.0);
                    assert_eq!(y, oy + 20.0);
                }
                (
                    RenderCommand::DrawGlyph { x: ox, y: oy, .. },
                    RenderCommand::DrawGlyph { x, y, .. },
                ) => {
                    assert_eq!(x, ox + 10.0);
                    assert_eq!(y, oy + 20.0);
                }
                (
                    RenderCommand::DrawPolygon { points: orig, .. },
                    RenderCommand::DrawPolygon { points, .. },
                ) => {
                    assert_eq!(points.len(), orig.len());
                    for (i, &(px, py)) in points.iter().enumerate() {
                        assert_eq!(px, orig[i].0 + 10.0);
                        assert_eq!(py, orig[i].1 + 20.0);
                    }
                }
                (
                    RenderCommand::DrawFilledBezier {
                        x1: ox1,
                        y1: oy1,
                        x2: ox2,
                        y2: oy2,
                        ocx1: oo1x,
                        ocy1: oo1y,
                        ocx2: oo2x,
                        ocy2: oo2y,
                        icx1: oi1x,
                        icy1: oi1y,
                        icx2: oi2x,
                        icy2: oi2y,
                        ..
                    },
                    RenderCommand::DrawFilledBezier {
                        x1,
                        y1,
                        x2,
                        y2,
                        ocx1,
                        ocy1,
                        ocx2,
                        ocy2,
                        icx1,
                        icy1,
                        icx2,
                        icy2,
                        ..
                    },
                ) => {
                    assert_eq!(x1, ox1 + 10.0);
                    assert_eq!(y1, oy1 + 20.0);
                    assert_eq!(x2, ox2 + 10.0);
                    assert_eq!(y2, oy2 + 20.0);
                    assert_eq!(ocx1, oo1x + 10.0);
                    assert_eq!(ocy1, oo1y + 20.0);
                    assert_eq!(ocx2, oo2x + 10.0);
                    assert_eq!(ocy2, oo2y + 20.0);
                    assert_eq!(icx1, oi1x + 10.0);
                    assert_eq!(icy1, oi1y + 20.0);
                    assert_eq!(icx2, oi2x + 10.0);
                    assert_eq!(icy2, oi2y + 20.0);
                }
                (
                    RenderCommand::SetOpacity { opacity: oo },
                    RenderCommand::SetOpacity { opacity },
                ) => {
                    // SetOpacity is coordinate-free; must be untouched.
                    assert_eq!(opacity, oo);
                }
                (a, b) => panic!("variant mismatch: {:?} vs {:?}", a, b),
            }
        }
    }

    #[test]
    fn translate_zero_is_a_noop() {
        let mut dl = DisplayList::new(100.0, 100.0);
        for cmd in all_variants() {
            dl.commands.push(cmd);
        }
        let before = dl.commands.clone();

        dl.translate(0.0, 0.0);

        // Same number of commands, and rect (a coordinate-bearing variant) untouched.
        assert_eq!(dl.commands.len(), before.len());
        for (a, b) in dl.commands.iter().zip(before.iter()) {
            if let (
                RenderCommand::DrawRect { x: ax, y: ay, .. },
                RenderCommand::DrawRect { x: bx, y: by, .. },
            ) = (a, b)
            {
                assert_eq!(ax, bx);
                assert_eq!(ay, by);
            }
        }
    }

    #[test]
    fn display_list_translate_shifts_every_store() {
        let mut dl = DisplayList::new(100.0, 100.0);

        // Commands: one of each variant.
        for cmd in all_variants() {
            dl.commands.push(cmd);
        }

        // element_bboxes
        dl.element_bboxes.push(ElementBBox {
            element_id: "e1".into(),
            bbox: BoundingBox {
                x: 1.0,
                y: 2.0,
                width: 3.0,
                height: 4.0,
            },
        });

        // measure_bounds (with beat anchors)
        dl.measure_bounds.push(MeasureBounds {
            index: 0,
            measure_id: None,
            part_index: 0,
            staff_index: 0,
            system_index: 0,
            x: 10.0,
            width: 50.0,
            y: 20.0,
            height: 40.0,
            prefix_width: 5.0,
            total_beats: 4.0,
            beat_anchors: vec![(0.0, 12.0), (1.0, 24.0), (2.0, 36.0)],
            ghost_staff: false,
            is_hidden: false,
            has_music_hidden: false,
            is_expansion: false,
        });

        // pages
        dl.pages.push(PageLayout {
            page_number: 0,
            system_indices: vec![0],
            y_offset: 7.0,
            height: 100.0,
        });

        // layout_debug.systems[*]
        dl.layout_debug = Some(LayoutDebugInfo {
            systems: vec![SystemDebug {
                index: 0,
                page_index: 0,
                bbox_top_y: 1.0,
                staff_top_y: 2.0,
                staff_bottom_y: 3.0,
                bbox_bottom_y: 4.0,
                x_start: 10.0,
                x_end: 90.0,
                above_extra: 0.0,
                above_breakdown: AboveBreakdown {
                    stem_extra: 0.0,
                    annotation_extra: 0.0,
                    has_tempo: false,
                    has_rehearsal: false,
                    has_jump: false,
                },
                below_extra: 0.0,
                below_breakdown: BelowBreakdown {
                    protrusion: 0.0,
                    dynamics: 0.0,
                    lyrics: 0.0,
                    pedals: 0.0,
                    has_dynamics: false,
                    has_lyrics: false,
                    has_pedals: false,
                },
                measure_extremes: vec![],
                staff_pairs: vec![],
                measure_spacings: vec![],
                inter_system_gap_to_next: None,
            }],
            sp: 4.0,
            staff_height: 16.0,
            min_note_spacing: 0.0,
            shortest_duration_space: 0.0,
            spacing_increment: 0.0,
            placement: std::collections::HashMap::new(),
        });

        let dx = 10.0;
        let dy = 20.0;
        dl.translate(dx, dy);

        // element_bboxes shifted
        assert_eq!(dl.element_bboxes[0].bbox.x, 11.0);
        assert_eq!(dl.element_bboxes[0].bbox.y, 22.0);
        // size unchanged
        assert_eq!(dl.element_bboxes[0].bbox.width, 3.0);
        assert_eq!(dl.element_bboxes[0].bbox.height, 4.0);

        // measure_bounds shifted (incl. beat anchors x; beat values untouched)
        let mb = &dl.measure_bounds[0];
        assert_eq!(mb.x, 20.0);
        assert_eq!(mb.y, 40.0);
        assert_eq!(mb.beat_anchors[0], (0.0, 22.0));
        assert_eq!(mb.beat_anchors[1], (1.0, 34.0));
        assert_eq!(mb.beat_anchors[2], (2.0, 46.0));

        // pages: y_offset shifted, height unchanged
        assert_eq!(dl.pages[0].y_offset, 27.0);
        assert_eq!(dl.pages[0].height, 100.0);

        // layout_debug systems all *_y shifted by dy, x_start/x_end by dx
        let sys = &dl.layout_debug.as_ref().unwrap().systems[0];
        assert_eq!(sys.bbox_top_y, 21.0);
        assert_eq!(sys.staff_top_y, 22.0);
        assert_eq!(sys.staff_bottom_y, 23.0);
        assert_eq!(sys.bbox_bottom_y, 24.0);
        assert_eq!(sys.x_start, 20.0);
        assert_eq!(sys.x_end, 100.0);
    }

    fn line(x: f64) -> RenderCommand {
        RenderCommand::DrawLine {
            x1: x,
            y1: 0.0,
            x2: x,
            y2: 1.0,
            width: 1.0,
            color: "#000".into(),
        }
    }

    #[test]
    fn append_rebases_shape_cmd_indices() {
        // Base list: 2 untagged commands, a `Cmd` shape pointing at cmd 1.
        let mut base = DisplayList::new(0.0, 0.0);
        base.push(line(0.0));
        base.push(line(1.0));
        base.push_shape_cmd(1, "base/stem".into(), ElementKind::Stem, Some(0), None);

        // Segment rendered in isolation: its own `Cmd` shape points at *its*
        // command 0 (segment-relative).
        let mut seg = DisplayList::new(0.0, 0.0);
        seg.push(line(2.0));
        seg.push_shape_cmd(0, "seg/stem".into(), ElementKind::Stem, Some(1), None);

        base.append(seg);

        assert_eq!(base.commands.len(), 3);
        // Base shape index untouched; segment shape re-based by 2.
        let base_cmd = match &base.element_shapes[0].geom {
            ShapeGeom::Cmd { cmd_idx } => *cmd_idx,
            _ => panic!("expected Cmd geom"),
        };
        let seg_cmd = match &base.element_shapes[1].geom {
            ShapeGeom::Cmd { cmd_idx } => *cmd_idx,
            _ => panic!("expected Cmd geom"),
        };
        assert_eq!(base_cmd, 1, "base shape index must not move");
        assert_eq!(
            seg_cmd, 2,
            "segment shape index must be re-based by cmd_base"
        );
        // system_idx is a logical id, not re-based.
        assert_eq!(base.element_shapes[1].system_idx, Some(1));
    }

    #[test]
    fn append_keeps_element_ids_index_aligned() {
        // Base: untagged commands only (empty element_ids).
        let mut base = DisplayList::new(0.0, 0.0);
        base.push(line(0.0));
        base.push(line(1.0));
        assert!(base.element_ids.is_empty());

        // Segment: a tagged then an untagged command.
        let mut seg = DisplayList::new(0.0, 0.0);
        seg.push_tagged(line(2.0), "seg/note".into());
        seg.push(line(3.0));

        base.append(seg);

        // element_ids must be full-length and aligned: [None, None, Some, None].
        assert_eq!(base.commands.len(), 4);
        assert_eq!(base.element_ids.len(), 4);
        assert_eq!(base.element_ids[0], None);
        assert_eq!(base.element_ids[1], None);
        assert_eq!(base.element_ids[2], Some("seg/note".to_string()));
        assert_eq!(base.element_ids[3], None);
    }

    #[test]
    fn append_into_empty_dl_preserves_tags() {
        // Regression: when the destination starts completely empty (no title
        // block, e.g. unpaged layout), appending the first tagged segment must
        // still carry the segment's element_ids across. The earlier guard
        // skipped the copy because the destination's element_ids was empty.
        let mut base = DisplayList::new(0.0, 0.0);
        assert!(base.commands.is_empty());

        let mut seg = DisplayList::new(0.0, 0.0);
        seg.push(line(0.0));
        seg.push_tagged(line(1.0), "seg/hairpin".into());

        base.append(seg);

        assert_eq!(base.commands.len(), 2);
        assert_eq!(base.element_ids.len(), 2);
        assert_eq!(base.element_ids[0], None);
        assert_eq!(base.element_ids[1], Some("seg/hairpin".to_string()));
    }

    #[test]
    fn append_of_untagged_into_tagged_backfills_none() {
        // Base already carries tags.
        let mut base = DisplayList::new(0.0, 0.0);
        base.push_tagged(line(0.0), "base/note".into());

        // Segment is entirely untagged (empty element_ids).
        let mut seg = DisplayList::new(0.0, 0.0);
        seg.push(line(1.0));
        seg.push(line(2.0));
        assert!(seg.element_ids.is_empty());

        base.append(seg);

        assert_eq!(base.element_ids.len(), 3);
        assert_eq!(base.element_ids[0], Some("base/note".to_string()));
        assert_eq!(base.element_ids[1], None);
        assert_eq!(base.element_ids[2], None);
    }

    #[test]
    fn append_concatenates_every_store() {
        let mut base = DisplayList::new(0.0, 0.0);
        base.push(line(0.0));
        base.element_bboxes.push(ElementBBox {
            element_id: "base/e".into(),
            bbox: BoundingBox {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
        });

        let mut seg = DisplayList::new(0.0, 0.0);
        seg.push(line(1.0));
        seg.element_bboxes.push(ElementBBox {
            element_id: "seg/e".into(),
            bbox: BoundingBox {
                x: 5.0,
                y: 5.0,
                width: 1.0,
                height: 1.0,
            },
        });

        base.append(seg);

        assert_eq!(base.commands.len(), 2);
        assert_eq!(base.element_bboxes.len(), 2);
        assert_eq!(base.element_bboxes[0].element_id, "base/e");
        assert_eq!(base.element_bboxes[1].element_id, "seg/e");
    }
}
