//! Fixed local GM SoundFont resource shared by native slots and binary IPC.

use std::fs::{self, File};
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

use tauri::Manager;

const SOUNDFONT_RESOURCE: &str = "sounds/Shan-SGM-Pro-15.sf2";

pub(super) fn resolve(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource = app
        .path()
        .resolve(SOUNDFONT_RESOURCE, tauri::path::BaseDirectory::Resource)
        .map_err(|error| format!("could not resolve bundled SoundFont resource: {error}"));
    resolve_candidates(resource, repository_fallback)
}

fn repository_fallback() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        Some(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("..")
                .join("..")
                .join("packages")
                .join("audio")
                .join("assets")
                .join(SOUNDFONT_RESOURCE),
        )
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

fn resolve_candidates(
    resource: Result<PathBuf, String>,
    fallback: impl FnOnce() -> Option<PathBuf>,
) -> Result<PathBuf, String> {
    let missing_resource = match resource {
        Ok(path) => {
            if validate_file(&path)? {
                return Ok(path);
            }
            format!("bundled SoundFont is missing at {}", path.display())
        }
        Err(error) => error,
    };
    if let Some(path) = fallback() {
        if validate_file(&path)? {
            return Ok(path);
        }
        return Err(format!(
            "{missing_resource}; debug repository SoundFont is missing at {}. \
             Restore the canonical asset with Git LFS; no network fallback is available.",
            path.display()
        ));
    }
    Err(format!(
        "{missing_resource}. Reinstall the bundled SoundFont resource; \
         no repository or network fallback is available."
    ))
}

/// Only absence permits fallback; a corrupt or unreadable bundled file is an error.
fn validate_file(path: &Path) -> Result<bool, String> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("cannot open SoundFont {}: {error}", path.display())),
    };
    let metadata = file
        .metadata()
        .map_err(|error| format!("cannot inspect SoundFont {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!(
            "SoundFont {} is not a regular file",
            path.display()
        ));
    }
    let mut header = [0; 64];
    let count = usize::try_from(metadata.len().min(header.len() as u64)).unwrap();
    file.read_exact(&mut header[..count])
        .map_err(|error| format!("cannot read SoundFont header {}: {error}", path.display()))?;
    validate_header(&header[..count], metadata.len())
        .map_err(|error| format!("invalid SoundFont {}: {error}", path.display()))?;
    Ok(true)
}

fn validate_header(header: &[u8], file_len: u64) -> Result<(), String> {
    if header.starts_with(b"version https://git-lfs.github.com/spec/v1") {
        return Err(
            "Git LFS pointer found instead of SF2 data; fetch the SoundFont with Git LFS"
                .to_owned(),
        );
    }
    if header.len() < 12 {
        return Err("truncated RIFF/sfbk header (expected at least 12 bytes)".to_owned());
    }
    if &header[..4] != b"RIFF" || &header[8..12] != b"sfbk" {
        return Err("expected a RIFF SoundFont with sfbk form type".to_owned());
    }
    let riff_size = u32::from_le_bytes(header[4..8].try_into().unwrap());
    if riff_size <= 4 || u64::from(riff_size) + 8 != file_len {
        return Err(format!(
            "invalid RIFF size: header declares {} bytes, file has {file_len} bytes",
            u64::from(riff_size) + 8
        ));
    }
    Ok(())
}

pub(super) fn read_response(path: &Path) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("cannot read SoundFont {}: {error}", path.display()))?;
    // Recheck the bytes in case the file changed after resolution.
    validate_header(&bytes, bytes.len() as u64)
        .map_err(|error| format!("invalid SoundFont {}: {error}", path.display()))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests;
