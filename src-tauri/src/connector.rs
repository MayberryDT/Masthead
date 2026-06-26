use serde::Serialize;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    env,
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread::sleep,
    time::Duration,
};
use tauri::{AppHandle, Manager};

const DEFAULT_CONNECTOR_PORT: u16 = 17373;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLiveConnectorResult {
    ok: bool,
    started: bool,
    base_url: String,
    command: String,
    health: MastheadHealthSummary,
    message: String,
    projection_url: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MastheadHealthSummary {
    api_version: Option<i64>,
    build_sha: Option<String>,
    database_id: Option<String>,
    database_path: Option<String>,
    data_directory: Option<String>,
    mode: Option<String>,
}
fn connector_port_from_env() -> u16 {
    std::env::var("MASTHEAD_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_CONNECTOR_PORT)
}

fn connector_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

#[tauri::command]
pub fn start_live_connector_command(app: AppHandle) -> Result<StartLiveConnectorResult, String> {
    let command_label = "masthead daemon".to_string();
    let launch = daemon_launch_target(&app)?;
    let connector_port = launch.port;
    let default_probe = probe_collector_at_for_data_directory(connector_port, &launch.data_directory);
    if let CollectorProbe::Compatible(health) = default_probe {
        let base_url = connector_base_url(connector_port);
        return Ok(StartLiveConnectorResult {
            ok: true,
            started: false,
            base_url: base_url.clone(),
            command: command_label,
            health,
            message: "Local Masthead collector is already running.".to_string(),
            projection_url: format!("{base_url}/projection"),
        });
    }

    if !launch.entry_path.exists() {
        return Err(format!("Masthead daemon entry not found at {}", launch.entry_path.display()));
    }

    let port = match default_probe {
        CollectorProbe::Offline => connector_port,
        CollectorProbe::Compatible(_) => connector_port,
        CollectorProbe::Incompatible => find_available_port(connector_port + 1)
            .ok_or_else(|| "no available Masthead connector port found".to_string())?,
    };
    let base_url = connector_base_url(port);

    Command::new(&launch.node_path)
        .arg(&launch.entry_path)
        .current_dir(&launch.cwd)
        .env("MASTHEAD_DATA_DIR", &launch.data_directory)
        .env("MASTHEAD_DB_PATH", &launch.database_path)
        .env("MASTHEAD_STORE_PATH", &launch.legacy_store_path)
        .env("MASTHEAD_HOST", "127.0.0.1")
        .env("MASTHEAD_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to start Masthead collector: {error}"))?;

    let health = wait_for_compatible_collector_for_data_directory(port, &launch.data_directory)
        .ok_or_else(|| format!("started Masthead collector but it did not become compatible at {base_url}/health"))?;

    Ok(StartLiveConnectorResult {
        ok: true,
        started: true,
        base_url: base_url.clone(),
        command: command_label,
        health,
        message: "Started local Masthead collector.".to_string(),
        projection_url: format!("{base_url}/projection"),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpLaunchValidationResult {
    ready: bool,
    valid: bool,
    command_exists: bool,
    entry_exists: bool,
    database_matches: bool,
    problems: Vec<String>,
    command_path: String,
    entry_path: String,
    configured_database_path: String,
    expected_database_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpLaunchConfigResult {
    command: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    database_path: String,
    validation: McpLaunchValidationResult,
}

#[tauri::command]
pub fn mcp_launch_config_command(app: AppHandle) -> Result<McpLaunchConfigResult, String> {
    let launch = mcp_launch_target(&app)?;
    Ok(mcp_launch_config_result(launch))
}

#[tauri::command]
pub fn mcp_validate_launch_config_command(app: AppHandle) -> Result<McpLaunchValidationResult, String> {
    let launch = mcp_launch_target(&app)?;
    Ok(validate_mcp_launch_target(&launch))
}


#[derive(Debug, Clone, PartialEq, Eq)]
struct DaemonLaunchTarget {
    data_directory: PathBuf,
    node_path: PathBuf,
    entry_path: PathBuf,
    cwd: PathBuf,
    database_path: PathBuf,
    legacy_store_path: PathBuf,
    port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct McpLaunchTarget {
    data_directory: PathBuf,
    node_path: PathBuf,
    entry_path: PathBuf,
    database_path: PathBuf,
}

#[derive(Debug, Clone)]
struct DaemonLaunchTargetInput {
    app_data_dir: PathBuf,
    resource_dir: PathBuf,
    current_dir: PathBuf,
    daemon_entry: Option<PathBuf>,
    node_path: Option<PathBuf>,
    project_dir: Option<PathBuf>,
    port: u16,
}

#[derive(Debug, Clone)]
struct McpLaunchTargetInput {
    app_data_dir: PathBuf,
    resource_dir: PathBuf,
    mcp_entry: Option<PathBuf>,
    node_path: Option<PathBuf>,
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
        port: connector_port_from_env(),
    })
}

fn mcp_launch_target(app: &AppHandle) -> Result<McpLaunchTarget, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;

    mcp_launch_target_from_paths(McpLaunchTargetInput {
        app_data_dir,
        resource_dir,
        mcp_entry: std::env::var("MASTHEAD_MCP_ENTRY").ok().map(PathBuf::from),
        node_path: std::env::var("MASTHEAD_NODE_PATH").ok().map(PathBuf::from),
    })
}

fn daemon_launch_target_from_paths(input: DaemonLaunchTargetInput) -> Result<DaemonLaunchTarget, String> {
    fs::create_dir_all(&input.app_data_dir).map_err(|error| error.to_string())?;
    let database_path = input.app_data_dir.join("masthead.sqlite");
    let legacy_store_path = input.app_data_dir.join("legacy").join("events.ndjson");

    if let Some(entry_path) = input.daemon_entry {
        return Ok(DaemonLaunchTarget {
            data_directory: input.app_data_dir,
            node_path: input.node_path.unwrap_or_else(|| PathBuf::from("node")),
            entry_path,
            cwd: input.project_dir.unwrap_or(input.current_dir),
            database_path,
            legacy_store_path,
            port: input.port,
        });
    }

    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    Ok(DaemonLaunchTarget {
        data_directory: input.app_data_dir.clone(),
        node_path: input.resource_dir.join("daemon").join(node_name),
        entry_path: input
            .resource_dir
            .join("daemon")
            .join("dist")
            .join("src")
            .join("daemon")
            .join("main.js"),
        cwd: input.app_data_dir.clone(),
        database_path,
        legacy_store_path,
        port: input.port,
    })
}

fn mcp_launch_target_from_paths(input: McpLaunchTargetInput) -> Result<McpLaunchTarget, String> {
    fs::create_dir_all(&input.app_data_dir).map_err(|error| error.to_string())?;
    let database_path = input.app_data_dir.join("masthead.sqlite");
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    Ok(McpLaunchTarget {
        data_directory: input.app_data_dir,
        node_path: input.node_path.unwrap_or_else(|| input.resource_dir.join("daemon").join(node_name)),
        entry_path: input.mcp_entry.unwrap_or_else(|| {
            input
                .resource_dir
                .join("daemon")
                .join("dist")
                .join("src")
                .join("mcp")
                .join("server.js")
        }),
        database_path,
    })
}

fn mcp_launch_config_result(launch: McpLaunchTarget) -> McpLaunchConfigResult {
    let mut launch_env = BTreeMap::new();
    launch_env.insert(
        "MASTHEAD_DATA_DIR".to_string(),
        launch.data_directory.to_string_lossy().to_string(),
    );
    launch_env.insert(
        "MASTHEAD_DB_PATH".to_string(),
        launch.database_path.to_string_lossy().to_string(),
    );
    let validation = validate_mcp_launch_target(&launch);
    McpLaunchConfigResult {
        args: vec![launch.entry_path.to_string_lossy().to_string()],
        command: launch.node_path.to_string_lossy().to_string(),
        database_path: launch.database_path.to_string_lossy().to_string(),
        env: launch_env,
        validation,
    }
}

fn validate_mcp_launch_target(launch: &McpLaunchTarget) -> McpLaunchValidationResult {
    let command_exists = command_exists(&launch.node_path);
    let entry_exists = launch.entry_path.is_file();
    let database_matches = launch.database_path == active_mcp_database_path(launch);
    let mut problems = Vec::new();
    if !command_exists {
        problems.push(format!("Command not found: {}", launch.node_path.display()));
    }
    if !entry_exists {
        problems.push(format!("MCP entry not found: {}", launch.entry_path.display()));
    }
    if !database_matches {
        problems.push(format!(
            "MASTHEAD_DB_PATH does not match active database: {}",
            active_mcp_database_path(launch).display()
        ));
    }
    let ready = problems.is_empty();
    let database_path = launch.database_path.to_string_lossy().to_string();
    McpLaunchValidationResult {
        ready,
        valid: ready,
        command_exists,
        entry_exists,
        database_matches,
        problems,
        command_path: launch.node_path.to_string_lossy().to_string(),
        entry_path: launch.entry_path.to_string_lossy().to_string(),
        configured_database_path: database_path.clone(),
        expected_database_path: database_path,
    }
}

fn active_mcp_database_path(launch: &McpLaunchTarget) -> PathBuf {
    launch.database_path.clone()
}

fn command_exists(command: &Path) -> bool {
    if command.is_absolute() || command.components().count() > 1 {
        return command.is_file();
    }
    let Some(paths) = env::var_os("PATH") else {
        return false;
    };
    env::split_paths(&paths).any(|directory| {
        let candidate = directory.join(command);
        if candidate.is_file() {
            return true;
        }
        if cfg!(windows) {
            return ["exe", "cmd", "bat"].iter().any(|extension| candidate.with_extension(extension).is_file());
        }
        false
    })
}

#[derive(Debug, Clone)]
enum CollectorProbe {
    Compatible(MastheadHealthSummary),
    Incompatible,
    Offline,
}

fn probe_collector_at_for_data_directory(port: u16, expected_data_directory: &PathBuf) -> CollectorProbe {
    match crate::http_probe::get_json_http_11("127.0.0.1", port, "/health", Duration::from_millis(500)) {
        Ok(value) => match parse_compatible_health_value_for_data_directory(&value, expected_data_directory) {
            Some(health) => CollectorProbe::Compatible(health),
            None => CollectorProbe::Incompatible,
        },
        Err(crate::http_probe::HttpProbeError::Connect) => CollectorProbe::Offline,
        Err(_) => CollectorProbe::Incompatible,
    }
}

fn parse_compatible_health_value_for_data_directory(value: &Value, expected_data_directory: &PathBuf) -> Option<MastheadHealthSummary> {
    let health = parse_compatible_health_value(value)?;
    let actual = health.data_directory.as_ref()?;
    if PathBuf::from(actual) != expected_data_directory.as_path() {
        return None;
    }
    Some(health)
}

#[cfg(test)]
fn parse_compatible_health(body: &str) -> Option<MastheadHealthSummary> {
    let value: Value = serde_json::from_str(body).ok()?;
    parse_compatible_health_value(&value)
}

fn parse_compatible_health_value(value: &Value) -> Option<MastheadHealthSummary> {
    if value.get("ok")?.as_bool()? != true {
        return None;
    }
    if value.get("product")?.as_str()? != "masthead" {
        return None;
    }
    let api_version = value.get("apiVersion")?.as_i64()?;
    if api_version < 1 {
        return None;
    }
    let capabilities = value.get("capabilities")?.as_array()?;
    for capability in [
        "live_projection",
        "canonical_sessions",
        "logbook_search",
        "source_discovery",
        "adapter_inventory",
        "mcp_status",
        "settings",
    ] {
        if !capabilities.iter().any(|value| value.as_str() == Some(capability)) {
            return None;
        }
    }
    if value
        .pointer("/data/migrationState")
        .and_then(Value::as_str)
        .is_some_and(|state| state == "failed")
    {
        return None;
    }

    Some(MastheadHealthSummary {
        api_version: Some(api_version),
        build_sha: value.get("buildSha").and_then(Value::as_str).map(ToString::to_string),
        database_id: value.pointer("/data/databaseId").and_then(Value::as_str).map(ToString::to_string),
        database_path: value.pointer("/data/databasePath").and_then(Value::as_str).map(ToString::to_string),
        data_directory: value.pointer("/data/dataDirectory").and_then(Value::as_str).map(ToString::to_string),
        mode: value.pointer("/runtime/mode").and_then(Value::as_str).map(ToString::to_string),
    })
}

fn wait_for_compatible_collector_for_data_directory(port: u16, expected_data_directory: &PathBuf) -> Option<MastheadHealthSummary> {
    for _ in 0..30 {
        if let CollectorProbe::Compatible(health) = probe_collector_at_for_data_directory(port, expected_data_directory) {
            return Some(health);
        }
        sleep(Duration::from_millis(150));
    }
    None
}

fn find_available_port(start_port: u16) -> Option<u16> {
    for port in start_port..=u16::MAX {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}


#[cfg(test)]
mod tests {
    use super::{
        daemon_launch_target_from_paths, mcp_launch_config_result, mcp_launch_target_from_paths, parse_compatible_health,
        parse_compatible_health_value, validate_mcp_launch_target, DaemonLaunchTargetInput, McpLaunchTarget,
        McpLaunchTargetInput, DEFAULT_CONNECTOR_PORT,
    };
    use serde_json::json;
    use std::{fs, path::PathBuf};
    use tempfile::tempdir;

    #[test]
    fn compatible_health_parser_accepts_current_contract_and_rejects_legacy() {
        let legacy = json!({ "ok": true, "events": 18 });
        assert!(parse_compatible_health_value(&legacy).is_none());

        let current = json!({
            "ok": true,
            "product": "masthead",
            "apiVersion": 1,
            "capabilities": [
                "live_projection",
                "canonical_sessions",
                "logbook_search",
                "source_discovery",
                "adapter_inventory",
                "mcp_status",
                "settings"
            ],
            "runtime": { "mode": "primary" },
            "data": {
                "databaseId": "db",
                "databasePath": "/tmp/masthead.sqlite",
                "migrationState": "ready",
                "dataDirectory": "/tmp/masthead-data"
            }
        });

        let parsed = parse_compatible_health_value(&current).expect("compatible health");
        assert_eq!(parsed.api_version, Some(1));
        assert_eq!(parsed.database_id, Some("db".to_string()));
        assert_eq!(parsed.database_path, Some("/tmp/masthead.sqlite".to_string()));
        assert_eq!(parsed.data_directory, Some("/tmp/masthead-data".to_string()));
        assert_eq!(parsed.mode, Some("primary".to_string()));
    }

    #[test]
    fn compatible_health_rejected_when_data_directory_is_wrong() {
        let current = json!({
            "ok": true,
            "product": "masthead",
            "apiVersion": 1,
            "capabilities": [
                "live_projection",
                "canonical_sessions",
                "logbook_search",
                "source_discovery",
                "adapter_inventory",
                "mcp_status",
                "settings"
            ],
            "runtime": { "mode": "primary" },
            "data": {
                "databaseId": "db",
                "databasePath": "/tmp/masthead-data/masthead.sqlite",
                "dataDirectory": "/tmp/masthead-data",
                "migrationState": "ready"
            }
        });

        assert!(super::parse_compatible_health_value_for_data_directory(&current, &PathBuf::from("/tmp/masthead-data")).is_some());
        assert!(super::parse_compatible_health_value_for_data_directory(&current, &PathBuf::from("/tmp/other-masthead")).is_none());
    }

    #[test]
    fn data_directory_matching_accepts_expected_directory() {
        let value = json!({
            "ok": true,
            "product": "masthead",
            "apiVersion": 1,
            "capabilities": [
                "live_projection",
                "canonical_sessions",
                "logbook_search",
                "source_discovery",
                "adapter_inventory",
                "mcp_status",
                "settings"
            ],
            "runtime": { "mode": "primary" },
            "data": {
                "databaseId": "db",
                "databasePath": "/tmp/masthead-data/masthead.sqlite",
                "dataDirectory": "/tmp/masthead-data",
                "migrationState": "ready"
            }
        });

        assert!(super::parse_compatible_health_value_for_data_directory(&value, &PathBuf::from("/tmp/masthead-data")).is_some());
        assert!(super::parse_compatible_health_value_for_data_directory(&value, &PathBuf::from("/tmp/other")).is_none());
    }

    #[test]
    fn compatible_health_parser_rejects_failed_migration() {
        let failed = json!({
            "ok": true,
            "product": "masthead",
            "apiVersion": 1,
            "capabilities": [
                "live_projection",
                "canonical_sessions",
                "logbook_search",
                "source_discovery",
                "adapter_inventory",
                "mcp_status",
                "settings"
            ],
            "data": { "migrationState": "failed" }
        });

        assert!(parse_compatible_health_value(&failed).is_none());
    }

    #[test]
    fn development_daemon_target_uses_env_entry_without_project_script() {
        let target = daemon_launch_target_from_paths(DaemonLaunchTargetInput {
            app_data_dir: PathBuf::from("/tmp/masthead-data"),
            resource_dir: PathBuf::from("/tmp/masthead-resources"),
            current_dir: PathBuf::from("/tmp/current"),
            daemon_entry: Some(PathBuf::from("/tmp/masthead/dist/daemon/src/daemon/main.js")),
            node_path: Some(PathBuf::from("/tmp/node")),
            project_dir: Some(PathBuf::from("/tmp/masthead")),
            port: 17374,
        })
        .expect("development target");

        assert_eq!(target.node_path, PathBuf::from("/tmp/node"));
        assert_eq!(target.entry_path, PathBuf::from("/tmp/masthead/dist/daemon/src/daemon/main.js"));
        assert_eq!(target.cwd, PathBuf::from("/tmp/masthead"));
        assert_eq!(target.data_directory, PathBuf::from("/tmp/masthead-data"));
        assert_eq!(target.database_path, PathBuf::from("/tmp/masthead-data/masthead.sqlite"));
        assert_eq!(target.legacy_store_path, PathBuf::from("/tmp/masthead-data/legacy/events.ndjson"));
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
            port: DEFAULT_CONNECTOR_PORT,
        })
        .expect("packaged target");

        let node_name = if cfg!(windows) { "node.exe" } else { "node" };
        assert_eq!(target.node_path, PathBuf::from("/tmp/masthead-resources/daemon").join(node_name));
        assert_eq!(
            target.entry_path,
            PathBuf::from("/tmp/masthead-resources/daemon/dist/src/daemon/main.js")
        );
        assert_eq!(target.cwd, PathBuf::from("/tmp/masthead-data"));
        assert_eq!(target.data_directory, PathBuf::from("/tmp/masthead-data"));
        assert_eq!(target.database_path, PathBuf::from("/tmp/masthead-data/masthead.sqlite"));
        assert_eq!(target.legacy_store_path, PathBuf::from("/tmp/masthead-data/legacy/events.ndjson"));
    }

    #[test]
    fn packaged_mcp_target_uses_resource_bundle_and_app_data_database() {
        let target = mcp_launch_target_from_paths(McpLaunchTargetInput {
            app_data_dir: PathBuf::from("/tmp/masthead-data"),
            resource_dir: PathBuf::from("/tmp/masthead-resources"),
            mcp_entry: None,
            node_path: None,
        })
        .expect("mcp target");

        let node_name = if cfg!(windows) { "node.exe" } else { "node" };
        assert_eq!(target.node_path, PathBuf::from("/tmp/masthead-resources/daemon").join(node_name));
        assert_eq!(
            target.entry_path,
            PathBuf::from("/tmp/masthead-resources/daemon/dist/src/mcp/server.js")
        );
        assert_eq!(target.data_directory, PathBuf::from("/tmp/masthead-data"));
        assert_eq!(target.database_path, PathBuf::from("/tmp/masthead-data/masthead.sqlite"));
    }

    #[test]
    fn development_mcp_target_uses_env_entry_without_project_script() {
        let target = mcp_launch_target_from_paths(McpLaunchTargetInput {
            app_data_dir: PathBuf::from("/tmp/masthead-data"),
            resource_dir: PathBuf::from("/tmp/masthead-resources"),
            mcp_entry: Some(PathBuf::from("/tmp/masthead/dist/daemon/src/mcp/server.js")),
            node_path: Some(PathBuf::from("/tmp/node")),
        })
        .expect("mcp target");

        assert_eq!(target.node_path, PathBuf::from("/tmp/node"));
        assert_eq!(target.entry_path, PathBuf::from("/tmp/masthead/dist/daemon/src/mcp/server.js"));
        assert_eq!(target.data_directory, PathBuf::from("/tmp/masthead-data"));
        assert_eq!(target.database_path, PathBuf::from("/tmp/masthead-data/masthead.sqlite"));
    }

    #[test]
    fn compatible_health_requires_masthead_protocol_identity() {
        let legacy = json!({
            "ok": true,
            "events": 18,
            "diagnostics": 0,
            "gitSnapshots": 18
        });
        assert!(parse_compatible_health(&legacy.to_string()).is_none());

        let current = json!({
            "ok": true,
            "product": "masthead",
            "apiVersion": 1,
            "capabilities": [
                "live_projection",
                "canonical_sessions",
                "logbook_search",
                "source_discovery",
                "adapter_inventory",
                "mcp_status",
                "settings"
            ],
            "runtime": { "mode": "primary" },
            "data": {
                "databaseId": "db",
                "databasePath": "/tmp/masthead.sqlite",
                "dataDirectory": "/tmp/masthead-data",
                "migrationState": "ready"
            }
        });
        let parsed = parse_compatible_health(&current.to_string()).expect("compatible health");
        assert_eq!(parsed.api_version, Some(1));
        assert_eq!(parsed.database_id, Some("db".to_string()));
        assert_eq!(parsed.data_directory, Some("/tmp/masthead-data".to_string()));
        assert_eq!(parsed.mode, Some("primary".to_string()));
    }

    #[test]
    fn mcp_launch_config_exports_database_env_and_validation() {
        let temp = tempdir().expect("tempdir");
        let app_data = temp.path().join("data");
        let entry = temp.path().join("server.js");
        fs::create_dir_all(&app_data).expect("app data");
        fs::write(&entry, "console.log('mcp');").expect("entry");

        let target = McpLaunchTarget {
            data_directory: app_data.clone(),
            node_path: std::env::current_exe().expect("current exe"),
            entry_path: entry.clone(),
            database_path: app_data.join("masthead.sqlite"),
        };
        let result = mcp_launch_config_result(target);

        assert_eq!(result.args, vec![entry.to_string_lossy().to_string()]);
        assert_eq!(
            result.env.get("MASTHEAD_DATA_DIR"),
            Some(&app_data.to_string_lossy().to_string())
        );
        assert_eq!(
            result.env.get("MASTHEAD_DB_PATH"),
            Some(&app_data.join("masthead.sqlite").to_string_lossy().to_string())
        );
        assert!(result.validation.ready);
        assert!(result.validation.valid);
        assert!(result.validation.command_exists);
        assert!(result.validation.entry_exists);
        assert!(result.validation.database_matches);
    }

    #[test]
    fn mcp_launch_validation_reports_missing_packaged_assets() {
        let target = McpLaunchTarget {
            data_directory: PathBuf::from("/tmp/masthead-data"),
            node_path: PathBuf::from("/tmp/masthead-missing-node"),
            entry_path: PathBuf::from("/tmp/masthead-missing-server.js"),
            database_path: PathBuf::from("/tmp/masthead-data/masthead.sqlite"),
        };

        let validation = validate_mcp_launch_target(&target);
        assert!(!validation.ready);
        assert!(!validation.valid);
        assert!(!validation.command_exists);
        assert!(!validation.entry_exists);
        assert!(validation.database_matches);
        assert!(validation.problems.iter().any(|problem| problem.contains("Command not found")));
        assert!(validation.problems.iter().any(|problem| problem.contains("MCP entry not found")));
    }
}
