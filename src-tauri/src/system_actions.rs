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

    platform_open_command(&directory)
        .spawn()
        .map_err(|error| format!("failed to open data directory: {error}"))?;
    Ok(())
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
