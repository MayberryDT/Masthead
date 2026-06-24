use serde::Serialize;
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Command, Stdio},
    time::Duration,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLiveConnectorResult {
    ok: bool,
    started: bool,
    command: String,
    message: String,
}

#[tauri::command]
pub fn start_live_connector_command() -> Result<StartLiveConnectorResult, String> {
    let command_label = "node scripts/masthead-ingest-server.js".to_string();
    if collector_responds() {
        return Ok(StartLiveConnectorResult {
            ok: true,
            started: false,
            command: command_label,
            message: "Local Masthead collector is already running.".to_string(),
        });
    }

    let project_dir = masthead_project_dir()?;
    let script = project_dir.join("scripts").join("masthead-ingest-server.js");
    if !script.exists() {
        return Err(format!(
            "Masthead ingest server script not found at {}",
            script.display()
        ));
    }

    Command::new("node")
        .arg(&script)
        .current_dir(&project_dir)
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

fn masthead_project_dir() -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("MASTHEAD_PROJECT_DIR") {
        return Ok(PathBuf::from(value));
    }

    std::env::current_dir().map_err(|error| error.to_string())
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
