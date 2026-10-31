use super::LayoutCache;
use crate::render::DisplayList;

impl LayoutCache {
    /// Phase R: get the cached overlay if its signature matches. Returns
    /// `Some(&DisplayList)` to splice; the caller is responsible for
    /// re-storing via `set_cached_overlay` if it builds fresh (with the new
    /// signature).
    pub(crate) fn get_cached_overlay(&self, signature: u64) -> Option<&DisplayList> {
        self.cached_overlay
            .as_ref()
            .and_then(|(sig, dl)| if *sig == signature { Some(dl) } else { None })
    }

    /// Phase R: store the fresh overlay with its inputs' signature.
    pub(crate) fn set_cached_overlay(&mut self, signature: u64, overlay: DisplayList) {
        self.cached_overlay = Some((signature, overlay));
    }

    pub(crate) fn update_paged_ottava_salt(&mut self, salt: u64) -> bool {
        self.last_paged_ottava_salt.replace(salt) == Some(salt)
    }
}
