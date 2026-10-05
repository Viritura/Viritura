use super::LayoutCache;

impl LayoutCache {
    pub(crate) fn check_instrument_timeline(&mut self, salt: u64) -> bool {
        let changed = self
            .instrument_timeline_salt
            .is_some_and(|previous| previous != salt);
        self.instrument_timeline_salt = Some(salt);
        changed
    }
}
