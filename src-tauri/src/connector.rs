use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Command, Stdio},
    time::Duration,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLiveConnectorResult {
    ok: bool,
    started: bool,
    command: String,
    message: String,
}

#[tauri::command]
pub fn start_live_connector_command(app: AppHandle) -> Result<StartLiveConnectorResult, String> {
    let command_label = "masthead daemon".to_string();
    if collector_responds() {
        return Ok(StartLiveConnectorResult {
            ok: true,
            started: false,
            command: command_label,
            message: "Local Masthead collector is already running.".to_string(),
        });
    }

    let launch = daemon_launch_target(&app)?;
    if !launch.entry_path.exists() {
        return Err(format!("Masthead daemon entry not found at {}", launch.entry_path.display()));
    }

    Command::new(&launch.node_path)
        .arg(&launch.entry_path)
        .current_dir(&launch.cwd)
        .env("MASTHEAD_DB_PATH", &launch.database_path)
        .env("MASTHEAD_STORE_PATH", &launch.legacy_store_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to start Masthead collector: {error}"))?;

    Ok(StartLiveConnectorResult {
        ok: true,
        started: true,
        command: command_label,
        message: "Started local Masthead collector.".to_string(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DaemonLaunchTarget {
    node_path: PathBuf,
    entry_path: PathBuf,
    cwd: PathBuf,
    database_path: PathBuf,
    legacy_store_path: PathBuf,
}

#[derive(Debug, Clone)]
struct DaemonLaunchTargetInput {
    app_data_dir: PathBuf,
    resource_dir: PathBuf,
    current_dir: PathBuf,
    daemon_entry: Option<PathBuf>,
    node_path: Option<PathBuf>,
    project_dir: Option<PathBuf>,
}

fn daemon_launch_target(app: &AppHandle) -> Result<DaemonLaunchTarget, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let current_dir = std::env::current_dir().map_err(|error| error.to_string())?;

    daemon_launch_target_from_paths(DaemonLaunchTargetInput {
        app_data_dir,
        resource_dir,
        current_dir,
        daemon_entry: std::env::var("MASTHEAD_DAEMON_ENTRY").ok().map(PathBuf::from),
        node_path: std::env::var("MASTHEAD_NODE_PATH").ok().map(PathBuf::from),
        project_dir: std::env::var("MASTHEAD_PROJECT_DIR").ok().map(PathBuf::from),
    })
}

fn daemon_launch_target_from_paths(input: DaemonLaunchTargetInput) -> Result<DaemonLaunchTarget, String> {
    fs::create_dir_all(&input.app_data_dir).map_err(|error| error.to_string())?;
    let database_path = input.app_data_dir.join("masthead.sqlite");
    let legacy_store_path = input.app_data_dir.join("events.ndjson");

    if let Some(entry_path) = input.daemon_entry {
        return Ok(DaemonLaunchTarget {
            node_path: input.node_path.unwrap_or_else(|| PathBuf::from("node")),
            entry_path,
            cwd: input.project_dir.unwrap_or(input.current_dir),
            database_path,
            legacy_store_path,
        });
    }

    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    Ok(DaemonLaunchTarget {
        node_path: input.resource_dir.join("daemon").join(node_name),
        entry_path: input
            .resource_dir
            .join("daemon")
            .join("dist")
            .join("src")
            .join("daemon")
            .join("main.js"),
        cwd: input.app_data_dir,
        database_path,
        legacy_store_path,
    })
}

fn collector_responds() -> bool {
    let address: SocketAddr = match "127.0.0.1:17373".parse() {
        Ok(address) => address,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_millis(180)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let request = b"GET /health HTTP/1.1\r\nHost: 127.0.0.1:17373\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }

    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok() && response.starts_with("HTTP/1.1 200")
}

#[cfg(test)]
mod tests {
    use super::{daemon_launch_target_from_paths, DaemonLaunchTargetInput};
    use std::path::PathBuf;

    #[test]
    fn development_daemon_target_uses_env_entry_without_project_script() {
        let target = daemon_launch_target_from_paths(DaemonLaunchTargetInput {
            app_data_dir: PathBuf::from("/tmp/masthead-data"),
            resource_dir: PathBuf::from("/tmp/masthead-resources"),
            current_dir: PathBuf::from("/tmp/current"),
            daemon_entry: Some(PathBuf::from("/tmp/masthead/dist/daemon/src/daemon/main.js")),
            node_path: Some(PathBuf::from("/tmp/node")),
            project_dir: Some(PathBuf::from("/tmp/masthead")),
        })
        .expect("development target");

        assert_eq!(target.node_path, PathBuf::from("/tmp/node"));
        assert_eq!(target.entry_path, PathBuf::from("/tmp/masthead/dist/daemon/src/daemon/main.js"));
        assert_eq!(target.cwd, PathBuf::from("/tmp/masthead"));
        assert_eq!(target.database_path, PathBuf::from("/tmp/masthead-data/masthead.sqlite"));
        assert_eq!(target.legacy_store_path, PathBuf::from("/tmp/masthead-data/events.ndjson"));
    }

    #[test]
    fn packaged_daemon_target_uses_resource_bundle_and_app_data() {
        let target = daemon_launch_target_from_paths(DaemonLaunchTargetInput {
            app_data_dir: PathBuf::from("/tmp/masthead-data"),
            resource_dir: PathBuf::from("/tmp/masthead-resources"),
            current_dir: PathBuf::from("/tmp/current"),
            daemon_entry: None,
            node_path: None,
            project_dir: None,
        })
        .expect("packaged target");

        let node_name = if cfg!(windows) { "node.exe" } else { "node" };
        assert_eq!(target.node_path, PathBuf::from("/tmp/masthead-resources/daemon").join(node_name));
        assert_eq!(
            target.entry_path,
            PathBuf::from("/tmp/masthead-resources/daemon/dist/src/daemon/main.js")
        );
        assert_eq!(target.cwd, PathBuf::from("/tmp/masthead-data"));
        assert_eq!(target.database_path, PathBuf::from("/tmp/masthead-data/masthead.sqlite"));
        assert_eq!(target.legacy_store_path, PathBuf::from("/tmp/masthead-data/events.ndjson"));
    }
}
