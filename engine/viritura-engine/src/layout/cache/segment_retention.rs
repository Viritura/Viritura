use std::sync::Arc;

use crate::render::{DisplayList, PageLayout, PageTurnWarning};

/// A fully-rendered system segment retained across layout passes.
pub(crate) struct RetainedSegment {
    pub rendered_x0: f64,
    pub rendered_y0: f64,
    pub segment: Arc<DisplayList>,
    pub slur_data: Option<RetainedSlurData>,
    /// Compact ranges into `segment` for each staff's content pass.
    pub staff_content_layers: Option<Vec<RetainedStaffContentLayer>>,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct DisplayListStoreMarker {
    pub commands: usize,
    pub element_bboxes: usize,
    pub element_shapes: usize,
    pub slur_geometries: usize,
    pub measure_bounds: usize,
}

pub(crate) struct RetainedStaffContentLayer {
    pub render_hash: u64,
    pub rendered_x0: f64,
    pub rendered_y: f64,
    pub start: DisplayListStoreMarker,
    pub end: DisplayListStoreMarker,
    /// Accidental obstacles appended while this staff rendered.
    pub accidental_obstacles: Vec<(u32, f64, f64, f64, f64)>,
}

/// Per-system slur/tie collection output captured at the rendered origin.
pub(crate) struct RetainedSlurData {
    pub bounds: Vec<((usize, usize, usize), super::slurs::SystemSlurBounds)>,
    pub events: Vec<super::slurs::GlobalSlurEvent>,
    pub notes: Vec<super::ties::GlobalTieNote>,
}

/// One system's placement in a [`PatchFrame`].
pub(crate) enum SystemPlacement {
    Reuse { prev_index: usize, dx: f64, dy: f64 },
    Fresh { segment: Arc<DisplayList> },
}

/// A delta frame describing how to transform the client's previously-held
/// per-system segments into the current layout.
pub(crate) struct PatchFrame {
    pub width: f64,
    pub height: f64,
    pub galley_offset_y: f64,
    pub prefix: DisplayList,
    pub placements: Vec<SystemPlacement>,
    pub pages: Vec<PageLayout>,
    pub overlay: DisplayList,
    #[allow(dead_code)]
    pub page_turn_warnings: Option<Vec<PageTurnWarning>>,
}

const PATCH_FORMAT_VERSION: f32 = 3.0;
const PLACEMENT_REUSE: f32 = 0.0;
const PLACEMENT_FRESH: f32 = 1.0;

impl PatchFrame {
    /// Serialize to the flat float-packed patch-frame wire format.
    pub(crate) fn to_binary(&self) -> Vec<f32> {
        let mut buf = vec![
            PATCH_FORMAT_VERSION,
            self.width as f32,
            self.height as f32,
            self.galley_offset_y as f32,
        ];

        buf.push(self.pages.len() as f32);
        for page in &self.pages {
            buf.push(page.page_number as f32);
            buf.push(page.system_indices.len() as f32);
            for &index in &page.system_indices {
                buf.push(index as f32);
            }
            buf.push(page.y_offset as f32);
            buf.push(page.height as f32);
        }

        let prefix = self.prefix.to_binary();
        buf.push(prefix.len() as f32);
        buf.extend_from_slice(&prefix);

        let overlay = self.overlay.to_binary();
        buf.push(overlay.len() as f32);
        buf.extend_from_slice(&overlay);

        buf.push(self.placements.len() as f32);
        for placement in &self.placements {
            match placement {
                SystemPlacement::Reuse { prev_index, dx, dy } => {
                    buf.push(PLACEMENT_REUSE);
                    buf.push(*prev_index as f32);
                    buf.push(*dx as f32);
                    buf.push(*dy as f32);
                }
                SystemPlacement::Fresh { segment } => {
                    buf.push(PLACEMENT_FRESH);
                    let segment = segment.to_binary();
                    buf.push(segment.len() as f32);
                    buf.extend_from_slice(&segment);
                }
            }
        }
        buf
    }
}
