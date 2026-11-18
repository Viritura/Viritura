use super::LayoutCache;

#[derive(Default)]
pub(super) struct ScoreDependencySalts {
    instrument_timeline: Option<u64>,
    repeat_glissando: Option<u64>,
}

impl LayoutCache {
    pub(crate) fn check_instrument_timeline(&mut self, salt: u64) -> bool {
        let changed = self
            .score_dependencies
            .instrument_timeline
            .is_some_and(|previous| previous != salt);
        self.score_dependencies.instrument_timeline = Some(salt);
        changed
    }

    pub(crate) fn check_repeat_glissandos(&mut self, salt: u64) -> bool {
        let changed = self
            .score_dependencies
            .repeat_glissando
            .is_some_and(|previous| previous != salt);
        self.score_dependencies.repeat_glissando = Some(salt);
        changed
    }
}
