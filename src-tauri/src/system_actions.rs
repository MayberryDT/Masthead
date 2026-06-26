use std::{path::PathBuf, process::Command};

#[tauri::command]
pub fn open_data_directory_command(path: String) -> Result<(), String> {
    let directory = PathBuf::from(path);
    if !directory.exists() {
        return Err(format!("Data directory does not exist: {}", directory.display()));
    }
    if !directory.is_dir() {
        return Err(format!("Data path is not a directory: {}", directory.display()));
    }
    if !is_masthead_owned_directory(&directory) {
        return Err(format!(
            "Refusing to open a non-Masthead data directory: {}",
            directory.display()
        ));
    }

    platform_open_command(&directory)
        .spawn()
        .map_err(|error| format!("failed to open data directory: {error}"))?;
    Ok(())
}

fn is_masthead_owned_directory(path: &PathBuf) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .to_ascii_lowercase()
            .contains("masthead")
    })
}

#[cfg(target_os = "windows")]
fn platform_open_command(path: &PathBuf) -> Command {
    let mut command = Command::new("explorer");
    command.arg(path);
    command
}

#[cfg(target_os = "macos")]
fn platform_open_command(path: &PathBuf) -> Command {
    let mut command = Command::new("open");
    command.arg(path);
    command
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_open_command(path: &PathBuf) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(path);
    command
}

#[cfg(test)]
mod tests {
    use super::is_masthead_owned_directory;
    use std::path::PathBuf;

    #[test]
    fn accepts_masthead_owned_data_paths() {
        assert!(is_masthead_owned_directory(&PathBuf::from("/home/tyler/.local/share/masthead-dev")));
        assert!(is_masthead_owned_directory(&PathBuf::from("/tmp/masthead-doctor-acceptance")));
    }

    #[test]
    fn rejects_unrelated_directories() {
        assert!(!is_masthead_owned_directory(&PathBuf::from("/home/tyler/Documents")));
        assert!(!is_masthead_owned_directory(&PathBuf::from("/tmp/project")));
    }
}
