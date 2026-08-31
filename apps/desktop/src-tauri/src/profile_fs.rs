//! Local-filesystem persistence for VST instrument profiles.
//!
//! The web/dev build keeps the profile registry and captured plugin state in
//! `localStorage`, which a browser caps at ~5 MB per origin — far too small for
//! the 1 MB+ opaque state blobs sample-based VST3 plugins produce. On desktop we
//! persist to real files under the app's data directory instead, which lifts
//! that limit entirely.
//!
//! The frontend store speaks in relative paths (e.g.
//! `instrument-profiles/state/<hash>.bin`); each is resolved under the app data
//! dir. Any path containing a root, prefix, or `..` component is rejected so a
//! request can never escape that directory.

use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Resolve a store-relative path under the app data directory, rejecting any
/// component that could escape it.
fn resolve(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("no app data dir: {error}"))?;
    let rel_path = Path::new(rel);
    let escapes = rel_path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    });
    if escapes {
        return Err(format!("unsafe profile path: {rel}"));
    }
    Ok(base.join(rel_path))
}

/// Ensure the parent directory of `path` exists so a write never fails purely
/// because the tree hasn't been created yet.
fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn profile_fs_read_text(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let full = resolve(&app, &path)?;
    match std::fs::read_to_string(&full) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn profile_fs_write_text(app: AppHandle, path: String, contents: String) -> Result<(), String> {
    let full = resolve(&app, &path)?;
    ensure_parent(&full)?;
    std::fs::write(&full, contents).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn profile_fs_read_binary(app: AppHandle, path: String) -> Result<Option<Vec<u8>>, String> {
    let full = resolve(&app, &path)?;
    match std::fs::read(&full) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn profile_fs_write_binary(app: AppHandle, path: String, bytes: Vec<u8>) -> Result<(), String> {
    let full = resolve(&app, &path)?;
    ensure_parent(&full)?;
    std::fs::write(&full, bytes).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn profile_fs_exists(app: AppHandle, path: String) -> Result<bool, String> {
    Ok(resolve(&app, &path)?.exists())
}

#[tauri::command]
pub fn profile_fs_rename(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let from_full = resolve(&app, &from)?;
    let to_full = resolve(&app, &to)?;
    ensure_parent(&to_full)?;
    std::fs::rename(&from_full, &to_full).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn profile_fs_mkdirp(app: AppHandle, dir: String) -> Result<(), String> {
    let full = resolve(&app, &dir)?;
    std::fs::create_dir_all(&full).map_err(|error| error.to_string())
}
