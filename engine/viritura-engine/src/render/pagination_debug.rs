use serde::{Deserialize, Serialize};

/// Optional measurements for the editor-only page/system overlay.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationDebugInfo {
    pub status: String,
    pub comfortable_secs: f64,
    pub vs_secs: f64,
    pub min_fill_fraction: f64,
    pub target_fill_fraction: f64,
    pub first_page_recto: bool,
    pub title_page: bool,
    pub measured_repacking: bool,
    pub pages: Vec<PaginationPageDebug>,
    pub systems: Vec<PaginationSystemDebug>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationPageDebug {
    pub page_index: usize,
    pub frame_top: f64,
    pub frame_bottom: f64,
    pub capacity: f64,
    pub content_height: f64,
    pub placed_height: f64,
    pub is_final_music_page: bool,
    pub kind: String,
    pub physical_turn_after: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationSystemDebug {
    pub system_index: usize,
    pub first_measure: usize,
    pub last_measure: usize,
    pub natural_width: f64,
    pub available_width: f64,
    pub page_break_after: bool,
    pub physical_turn_after: bool,
    pub planned_page_break_after: bool,
    pub boundary: Option<PaginationBoundaryDebug>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationBoundaryDebug {
    pub tail_seconds: f64,
    pub head_seconds: f64,
    pub head_rest_measures: usize,
    pub quality: String,
    pub structural: bool,
    pub fermata_blocked: bool,
    pub turn_cost: f64,
}
