//! Updates from a folder on this computer: new installers are dropped into
//! Documents\Calendaria\updates, and the app offers to install the newest one.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

type Version = (u64, u64, u64);

#[derive(Serialize)]
pub struct LocalUpdate {
    version: String,
    path: String,
}

/// Where updates are looked for. Documents may be redirected (e.g. to
/// OneDrive), so both the real Documents folder and ~/Documents are checked.
fn update_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(docs) = app.path().document_dir() {
        dirs.push(docs.join("Calendaria").join("updates"));
    }
    if let Ok(home) = app.path().home_dir() {
        dirs.push(home.join("Documents").join("Calendaria").join("updates"));
    }
    dirs.dedup();
    dirs
}

/// Reads the version from an installer name like `Calendaria_0.2.0_x64-setup.exe`.
fn installer_version(file_name: &str) -> Option<Version> {
    let rest = file_name.strip_prefix("Calendaria_")?;
    if !rest.ends_with("-setup.exe") {
        return None;
    }
    let mut parts = rest.split('_').next()?.split('.').map(|p| p.parse::<u64>().ok());
    let version = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(version)
}

fn newest_installer(dirs: &[PathBuf], current: Version) -> Option<(Version, PathBuf)> {
    dirs.iter()
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flatten()
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let version = installer_version(path.file_name()?.to_str()?)?;
            Some((version, path))
        })
        .filter(|(version, _)| *version > current)
        .max_by_key(|(version, _)| *version)
}

fn current_version(app: &AppHandle) -> Version {
    let v = &app.package_info().version;
    (v.major, v.minor, v.patch)
}

/// The newest installer in the updates folder that is newer than this app, if any.
#[tauri::command]
pub fn check_local_update(app: AppHandle) -> Option<LocalUpdate> {
    let ((major, minor, patch), path) = newest_installer(&update_dirs(&app), current_version(&app))?;
    Some(LocalUpdate {
        version: format!("{major}.{minor}.{patch}"),
        path: path.to_string_lossy().into_owned(),
    })
}

/// Runs the installer with a progress bar only, then relaunches the app.
#[tauri::command]
pub fn install_local_update(app: AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    // Only run installers from the updates folder, never an arbitrary path.
    let allowed = path.parent().is_some_and(|parent| update_dirs(&app).iter().any(|d| d == parent))
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(installer_version)
            .is_some();
    if !allowed {
        return Err("Not an installer in the updates folder".into());
    }
    std::process::Command::new(path)
        .args(["/P", "/UPDATE", "/R"])
        .spawn()
        .map_err(|e| format!("Couldn't start the installer: {e}"))?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_versions_from_installer_names() {
        assert_eq!(installer_version("Calendaria_0.2.0_x64-setup.exe"), Some((0, 2, 0)));
        assert_eq!(installer_version("Calendaria_1.10.3_x64-setup.exe"), Some((1, 10, 3)));
        assert_eq!(installer_version("Calendaria_0.2_x64-setup.exe"), None);
        assert_eq!(installer_version("Calendaria_0.2.0.1_x64-setup.exe"), None);
        assert_eq!(installer_version("Other_0.2.0_x64-setup.exe"), None);
        assert_eq!(installer_version("Calendaria_0.2.0_x64-setup.exe.txt"), None);
    }

    #[test]
    fn picks_the_newest_installer_newer_than_the_app() {
        let dir = std::env::temp_dir().join(format!("calendaria-updates-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in [
            "Calendaria_0.1.0_x64-setup.exe",
            "Calendaria_0.3.0_x64-setup.exe",
            "Calendaria_0.10.0_x64-setup.exe",
            "notes.txt",
        ] {
            std::fs::write(dir.join(name), b"").unwrap();
        }
        let dirs = vec![dir.clone()];
        let (version, path) = newest_installer(&dirs, (0, 2, 0)).unwrap();
        assert_eq!(version, (0, 10, 0));
        assert!(path.ends_with("Calendaria_0.10.0_x64-setup.exe"));
        assert!(newest_installer(&dirs, (0, 10, 0)).is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
