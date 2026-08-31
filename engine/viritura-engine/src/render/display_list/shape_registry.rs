use super::*;

/// True when `element_id` ends with `marker` followed by a non-empty
/// identifier of name characters — e.g. `/art-accent`, `/art-accent.staccato`.
fn has_named_suffix(element_id: &str, marker: &str) -> bool {
    element_id.rsplit_once(marker).is_some_and(|(_, suffix)| {
        !suffix.is_empty()
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.')
    })
}

/// Infer the [`ElementKind`] of an annotation/furniture bbox from its
/// canonical element-id suffix (see `layout::element_id`).
///
/// This is the single classification seam for the `element_bboxes` →
/// `element_shapes` bridge. Unknown ids (bare events, rests) fall through to
/// [`ElementKind::Other`].
pub fn classify_element_kind(element_id: &str) -> ElementKind {
    if element_id.ends_with("/artic") || has_named_suffix(element_id, "/art-") {
        ElementKind::Articulation
    } else if element_id.ends_with("/fermata") || element_id.ends_with("/ferm") {
        ElementKind::Fermata
    } else if element_id.ends_with("/ornament") {
        ElementKind::Ornament
    } else if element_id.ends_with("/tremolo") {
        ElementKind::Tremolo
    } else if element_id.ends_with("/clef") {
        ElementKind::Clef
    } else if element_id.ends_with("/key") {
        ElementKind::KeySig
    } else if element_id.ends_with("/time") {
        ElementKind::TimeSig
    } else if element_id.ends_with("/barline") {
        ElementKind::Barline
    } else if element_id.ends_with("/segno") {
        ElementKind::Segno
    } else if element_id.ends_with("/coda") {
        ElementKind::Coda
    } else if element_id.ends_with("/fine") {
        ElementKind::Fine
    } else if element_id.ends_with("/jump") {
        ElementKind::Jump
    } else if element_id.ends_with("/rehearsal") {
        ElementKind::RehearsalMark
    } else if element_id.ends_with("/mnum") {
        ElementKind::MeasureNumber
    } else if element_id.starts_with("gliss/") {
        ElementKind::Glissando
    } else if element_id.contains("/lyric") {
        ElementKind::Lyric
    } else if element_id.contains("/dynamic") {
        ElementKind::Dynamic
    } else if element_id.contains("/hairpin") {
        ElementKind::Hairpin
    } else if element_id.contains("/tuplet") {
        ElementKind::Tuplet
    } else if element_id.contains("/pedal") {
        ElementKind::Pedal
    } else if element_id.contains("/ottava") {
        ElementKind::Ottava
    } else if element_id.contains("/volta") {
        ElementKind::Volta
    } else if element_id.contains("/tempo") {
        ElementKind::Tempo
    } else if element_id.contains("/expr") {
        ElementKind::Expression
    } else if element_id.contains("/chord") {
        ElementKind::ChordSymbol
    } else {
        ElementKind::Other
    }
}

impl DisplayList {
    /// Register a shape whose geometry is held by a render command.
    pub fn push_shape_cmd(
        &mut self,
        cmd_idx: usize,
        element_id: String,
        kind: ElementKind,
        system_idx: Option<u32>,
        staff_idx: Option<u32>,
    ) {
        self.element_shapes.push(ElementShape {
            element_id,
            kind,
            geom: ShapeGeom::Cmd {
                cmd_idx: cmd_idx as u32,
            },
            system_idx,
            staff_idx,
        });
    }

    /// Register a shape with an explicit bounding box.
    pub fn push_shape_rect(
        &mut self,
        bbox: BoundingBox,
        element_id: String,
        kind: ElementKind,
        system_idx: Option<u32>,
        staff_idx: Option<u32>,
    ) {
        self.element_shapes.push(ElementShape {
            element_id,
            kind,
            geom: ShapeGeom::Rect { bbox },
            system_idx,
            staff_idx,
        });
    }

    /// Register pre-sampled `(x, y_top, y_bottom)` columns for a curved shape.
    pub fn push_shape_band(
        &mut self,
        samples: Vec<(f64, f64, f64)>,
        element_id: String,
        kind: ElementKind,
        system_idx: Option<u32>,
        staff_idx: Option<u32>,
    ) {
        self.element_shapes.push(ElementShape {
            element_id,
            kind,
            geom: ShapeGeom::Band { samples },
            system_idx,
            staff_idx,
        });
    }

    /// Extend the legacy bbox store while publishing equivalent shapes.
    pub fn extend_element_bboxes_with_shapes(&mut self, bboxes: Vec<ElementBBox>) {
        for bbox in bboxes {
            self.push_element_bbox_with_shape(bbox);
        }
    }

    /// Push one legacy bbox and its equivalent registered shape.
    pub fn push_element_bbox_with_shape(&mut self, bbox: ElementBBox) {
        let kind = classify_element_kind(&bbox.element_id);
        self.element_shapes.push(ElementShape {
            element_id: bbox.element_id.clone(),
            kind,
            geom: ShapeGeom::Rect {
                bbox: bbox.bbox.clone(),
            },
            system_idx: None,
            staff_idx: None,
        });
        self.element_bboxes.push(bbox);
    }

    /// Return the topmost included shape above `y_ref` across the X span.
    pub fn skyline_top(
        &self,
        x_min: f64,
        x_max: f64,
        y_ref: f64,
        mut include: impl FnMut(ElementKind) -> bool,
    ) -> Option<f64> {
        let mut best: Option<f64> = None;
        for shape in &self.element_shapes {
            if !include(shape.kind) {
                continue;
            }
            let Some((top, _)) = shape.span_extent(&self.commands, x_min, x_max) else {
                continue;
            };
            if top < y_ref {
                best = Some(best.map_or(top, |current| current.min(top)));
            }
        }
        best
    }

    /// Return the bottommost included shape below `y_ref` across the X span.
    pub fn skyline_bottom(
        &self,
        x_min: f64,
        x_max: f64,
        y_ref: f64,
        mut include: impl FnMut(ElementKind) -> bool,
    ) -> Option<f64> {
        let mut best: Option<f64> = None;
        for shape in &self.element_shapes {
            if !include(shape.kind) {
                continue;
            }
            let Some((_, bottom)) = shape.span_extent(&self.commands, x_min, x_max) else {
                continue;
            };
            if bottom > y_ref {
                best = Some(best.map_or(bottom, |current| current.max(bottom)));
            }
        }
        best
    }
}
