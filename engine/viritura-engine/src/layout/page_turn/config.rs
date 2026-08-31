//! Configuration for page-turn-aware pagination.
//!
//! See `docs/plans/auto-page-breaks.md`. All knobs live here so the optimizer
//! and analysis stay pure functions of `(inputs, PageTurnConfig)`.

use serde::{Deserialize, Serialize};

/// Policy for whether a part opens with a dedicated title/cover page.
///
/// A leading title page shifts every subsequent page's recto/verso parity by
/// one, which is the single biggest lever on where physical page turns land.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TitlePagePolicy {
    /// Evaluate both with and without a title page; keep the cheaper layout.
    #[default]
    Auto,
    /// Always reserve a leading title page (music starts on page 2).
    Always,
    /// Never insert a title page (music starts on page 1).
    Never,
}

/// Convenience preset that flips several related knobs at once.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngravingPreset {
    /// Amateur / educational / rehearsal default: partial pages and
    /// intentional blanks allowed to make turns easy.
    Relaxed,
    /// Professional engraving house: fully-justified, evenly-dense pages,
    /// no sparse or blank pages; accept a tighter turn before wasting paper.
    Professional,
}

/// Tunable cost weights for the page-break optimizer.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PageTurnWeights {
    /// Weight on deviation of page fill from its natural target density.
    pub density: f64,
    /// Weight on turn quality at real (physical) turn boundaries.
    pub turn: f64,
    /// Slope of the penalty applied to pages that fall *below* the acceptable
    /// fill band (`min_fill_fraction`). Charged LINEARLY in the shortfall so it
    /// bites immediately below the floor rather than staying flat near it.
    /// Sparse is the amateur-looking failure mode.
    pub sparse: f64,
    /// Penalty for adding a dedicated title page (so we only add one when it
    /// meaningfully improves the turn profile).
    pub title_page: f64,
    /// Penalty for inserting a deliberately blank page for parity.
    pub blank_page: f64,
    /// Penalty for a turn that relies on the *next* page's opening rest (an
    /// MMR pushed past the turn), forcing a "time" marking. Biases the
    /// optimizer toward pulling the rest before the turn even at a density
    /// cost; scales with how far the before-turn (tail) rest falls short of
    /// comfortable, so it never overrides a genuinely worse alternative.
    pub time_marking: f64,
}

impl Default for PageTurnWeights {
    fn default() -> Self {
        Self {
            density: 1.0,
            turn: 1.0,
            sparse: 6.0,
            title_page: 0.0,
            blank_page: 0.8,
            time_marking: 1.0,
        }
    }
}

/// Full configuration for page-turn-aware pagination.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PageTurnConfig {
    /// Master switch. Auto-pagination only runs for parts in paged layout;
    /// default `false` so the full-score / existing greedy path is untouched.
    pub enabled: bool,
    /// Turn window (seconds) at or above which a turn is fully relaxed
    /// (cost ≈ 0).
    pub comfortable_secs: f64,
    /// Lower edge (seconds) of the *volti subito* band. A window between
    /// `vs_secs` and `comfortable_secs` is a usable quick turn (V.S.).
    pub vs_secs: f64,
    /// The turn-quality floor (seconds). Below this a turn is a desperation
    /// turn (high cost, flagged); the optimizer will not trade density away
    /// chasing a roomier turn once a boundary clears this floor.
    pub min_acceptable_secs: f64,
    /// Natural page density the `density_cost` term pulls toward
    /// (fraction of usable page height, e.g. 0.9).
    pub target_fill_fraction: f64,
    /// Lower edge of the *acceptable* fill band. A page filled between this
    /// fraction and 100% is considered good; anything below it is "sparse" and
    /// incurs the `sparse` shortfall penalty. Defaults to 0.75.
    pub min_fill_fraction: f64,
    /// Lower edge at which a turn-driven partial page is vertically justified.
    /// This may sit below `min_fill_fraction`: the planner still prefers denser
    /// pages, while a narrowly sub-floor page can fill vertically instead of
    /// looking accidentally unfinished. Defaults to 0.65.
    pub vertical_justify_threshold: f64,
    /// Whether the optimizer may end a page below the vertical-justification
    /// threshold (leaving it intentionally sparse) to win a turn.
    pub allow_partial_pages: bool,
    /// Whether the optimizer may insert a deliberately blank page to fix
    /// turn parity.
    pub allow_intentional_blanks: bool,
    /// Title-page policy.
    pub title_page: TitlePagePolicy,
    /// Whether the first physical page is a lone recto (right-hand) page.
    /// `None` uses the standard recto-first binding (turns fall after even
    /// pages); the title page is then the lever that shifts turn parity. Set
    /// `Some(_)` only to force an unusual binding.
    pub first_page_recto: Option<bool>,
    /// Whether to emit printed **V.S.** / **"time"** annotations.
    pub emit_vs_marks: bool,
    /// Default tempo (bpm on a quarter) used when no tempo mark is present.
    pub default_bpm: f64,
    /// Cost weights.
    pub weights: PageTurnWeights,
}

impl Default for PageTurnConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            comfortable_secs: 5.0,
            vs_secs: 3.0,
            min_acceptable_secs: 3.0,
            target_fill_fraction: 0.9,
            min_fill_fraction: 0.75,
            vertical_justify_threshold: 0.65,
            allow_partial_pages: true,
            allow_intentional_blanks: true,
            title_page: TitlePagePolicy::Auto,
            first_page_recto: None,
            emit_vs_marks: true,
            default_bpm: 90.0,
            weights: PageTurnWeights::default(),
        }
    }
}

impl PageTurnConfig {
    /// Apply a convenience preset, flipping the relief-valve toggles and
    /// tightening density for the professional case.
    pub fn with_preset(mut self, preset: EngravingPreset) -> Self {
        match preset {
            EngravingPreset::Relaxed => {
                self.allow_partial_pages = true;
                self.allow_intentional_blanks = true;
                self.target_fill_fraction = 0.9;
                self.min_fill_fraction = 0.75;
                self.vertical_justify_threshold = 0.65;
            }
            EngravingPreset::Professional => {
                self.allow_partial_pages = false;
                self.allow_intentional_blanks = false;
                self.target_fill_fraction = 0.95;
                self.min_fill_fraction = 0.85;
                self.vertical_justify_threshold = 0.85;
            }
        }
        self
    }
}
