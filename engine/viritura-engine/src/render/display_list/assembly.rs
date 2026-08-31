use super::*;

impl DisplayList {
    /// Translate every coordinate-bearing field in this DisplayList by (dx, dy).
    ///
    /// This is the *only* sanctioned way to globally shift display-list content.
    /// It is mechanically exhaustive over every store that holds layout-space
    /// coordinates so that all stores stay in lockstep. **If you add a new
    /// coordinate-bearing field to `DisplayList`, you must extend this method.**
    ///
    /// Stores translated:
    /// * `commands` — every render command (via `RenderCommand::translate_in_place`)
    /// * `element_bboxes` — bbox.x and bbox.y
    /// * `slur_geometries` — spine endpoints + control points
    /// * `measure_bounds` — x and y (and beat anchors' x)
    /// * `layout_debug.systems[*]` — all *_y fields and x_start/x_end
    /// * `pages[].y_offset` — page positions
    pub fn translate(&mut self, dx: f64, dy: f64) {
        if dx == 0.0 && dy == 0.0 {
            return;
        }

        for cmd in &mut self.commands {
            cmd.translate_in_place(dx, dy);
        }
        for eb in &mut self.element_bboxes {
            eb.bbox.x += dx;
            eb.bbox.y += dy;
        }
        // `ShapeGeom::Cmd` shapes don't need translation — they re-derive from
        // the already-translated command. `Rect` and `Band` store absolute
        // geometry and must be shifted.
        for sh in &mut self.element_shapes {
            match &mut sh.geom {
                ShapeGeom::Rect { bbox } => {
                    bbox.x += dx;
                    bbox.y += dy;
                }
                ShapeGeom::Band { samples } => {
                    for sample in samples {
                        sample.0 += dx;
                        sample.1 += dy;
                        sample.2 += dy;
                    }
                }
                ShapeGeom::Cmd { .. } => {}
            }
        }
        for geometry in &mut self.slur_geometries {
            geometry.p0_x += dx;
            geometry.p0_y += dy;
            geometry.p1_x += dx;
            geometry.p1_y += dy;
            geometry.p2_x += dx;
            geometry.p2_y += dy;
            geometry.p3_x += dx;
            geometry.p3_y += dy;
        }
        for bounds in &mut self.measure_bounds {
            bounds.x += dx;
            bounds.y += dy;
            for (_, anchor_x) in &mut bounds.beat_anchors {
                *anchor_x += dx;
            }
        }
        for page in &mut self.pages {
            page.y_offset += dy;
        }
        if let Some(debug) = &mut self.layout_debug {
            for system in &mut debug.systems {
                system.bbox_top_y += dy;
                system.staff_top_y += dy;
                system.staff_bottom_y += dy;
                system.bbox_bottom_y += dy;
                system.x_start += dx;
                system.x_end += dx;
            }
        }
    }

    /// Concatenate `other`'s per-system content stores onto the end of this
    /// list, preserving every parallel-store invariant.
    ///
    /// This is the assembly counterpart to per-system *segmentation*: a full
    /// display list is built by appending each system's segment in order.
    /// The one non-trivial fix-up is `ShapeGeom::Cmd { cmd_idx }` — those
    /// indices are command offsets, so they are re-based by this list's
    /// current command count to keep pointing at the same (now shifted)
    /// command. `element_ids` is normalized to stay index-aligned with
    /// `commands` even when one side carried only untagged commands.
    ///
    /// `other.pages` and `other.layout_debug` are intentionally ignored:
    /// segments carry only content stores; page/debug assembly is the
    /// caller's responsibility.
    pub fn append(&mut self, other: DisplayList) {
        let cmd_base = self.commands.len();
        self.commands.extend(other.commands);
        let appended = self.commands.len() - cmd_base;

        // Maintain the `element_ids` parallel-store invariant. If *either* side
        // carries tags, the merged store must stay index-aligned to `commands`:
        // backfill our side up to `cmd_base` and pad the appended ids to their
        // command count. Fully untagged lists retain the lazy empty store.
        if !self.element_ids.is_empty() || !other.element_ids.is_empty() {
            self.element_ids.resize(cmd_base, None);
            let mut other_ids = other.element_ids;
            other_ids.resize(appended, None);
            self.element_ids.extend(other_ids);
        }

        self.element_bboxes.extend(other.element_bboxes);

        for mut shape in other.element_shapes {
            if let ShapeGeom::Cmd { cmd_idx } = &mut shape.geom {
                *cmd_idx += cmd_base as u32;
            }
            self.element_shapes.push(shape);
        }

        self.slur_geometries.extend(other.slur_geometries);
        self.measure_bounds.extend(other.measure_bounds);
    }
}
