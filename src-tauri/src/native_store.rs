use rusqlite::{params, types::Type, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStoreRecord {
    pub record_id: String,
    pub record_type: String,
    pub observed_at: String,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearLocalDataResult {
    pub removed_records: usize,
    pub touched_external_state: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPolicy {
    pub cutoff_at: Option<String>,
    pub keep_latest: Option<usize>,
    #[serde(default)]
    pub record_types: Vec<String>,
    #[serde(default)]
    pub pinned_record_ids: Vec<String>,
    pub keep_unresolved_attention: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneLocalDataResult {
    pub removed_records: usize,
    pub removed_record_ids: Vec<String>,
    pub removed_by_type: HashMap<String, usize>,
    pub retained_records: usize,
    pub touched_external_state: bool,
}

pub struct NativeStore {
    connection: Connection,
}

pub fn open_native_store(path: impl AsRef<Path>) -> rusqlite::Result<NativeStore> {
    if let Some(parent) = path.as_ref().parent() {
        fs::create_dir_all(parent).map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;
    }

    let connection = Connection::open(path)?;
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS masthead_records (
          record_id TEXT PRIMARY KEY NOT NULL,
          record_type TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          value_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS masthead_records_type_idx ON masthead_records(record_type);
        CREATE INDEX IF NOT EXISTS masthead_records_observed_idx ON masthead_records(observed_at);
        ",
    )?;
    Ok(NativeStore { connection })
}

pub fn write_native_records(store: &NativeStore, records: &[NativeStoreRecord]) -> rusqlite::Result<()> {
    for record in records {
        store.connection.execute(
            "
            INSERT INTO masthead_records (record_id, record_type, observed_at, value_json)
            VALUES (?1, ?2, ?3, ?4)
            ",
            params![
                record.record_id,
                record.record_type,
                record.observed_at,
                record.value.to_string()
            ],
        )?;
    }
    Ok(())
}

pub fn read_native_records(store: &NativeStore) -> rusqlite::Result<Vec<NativeStoreRecord>> {
    let mut statement = store.connection.prepare(
        "
        SELECT record_id, record_type, observed_at, value_json
        FROM masthead_records
        ORDER BY rowid ASC
        ",
    )?;
    let records = statement.query_map([], |row| {
        let value_json: String = row.get(3)?;
        let value = serde_json::from_str(&value_json)
            .map_err(|error| rusqlite::Error::FromSqlConversionFailure(3, Type::Text, Box::new(error)))?;
        Ok(NativeStoreRecord {
            record_id: row.get(0)?,
            record_type: row.get(1)?,
            observed_at: row.get(2)?,
            value,
        })
    })?;

    records.collect()
}

pub fn export_native_records(store: &NativeStore, exported_at: &str) -> rusqlite::Result<String> {
    let records = read_native_records(store)?;
    let body = json!({
        "metadata": {
            "format": "masthead.native-store.v1",
            "schemaVersion": 1,
            "exportedAt": exported_at,
            "recordCount": records.len()
        },
        "records": records
    });
    Ok(body.to_string())
}

pub fn clear_native_store(store: &NativeStore) -> rusqlite::Result<ClearLocalDataResult> {
    let removed_records = store
        .connection
        .execute("DELETE FROM masthead_records", [])?;
    Ok(ClearLocalDataResult {
        removed_records,
        touched_external_state: false,
    })
}

pub fn prune_native_records(store: &NativeStore, policy: &RetentionPolicy) -> rusqlite::Result<PruneLocalDataResult> {
    let records = read_native_records(store)?;
    let mut protected_record_ids = HashSet::new();
    let mut selected_records: Vec<&NativeStoreRecord> = records
        .iter()
        .filter(|record| matches_retention_type(record, policy))
        .collect();

    if let Some(keep_latest) = policy.keep_latest {
        selected_records.sort_by(|a, b| {
            b.observed_at
                .cmp(&a.observed_at)
                .then(a.record_type.cmp(&b.record_type))
                .then(a.record_id.cmp(&b.record_id))
        });
        for record in selected_records.into_iter().take(keep_latest) {
            protected_record_ids.insert(record.record_id.clone());
        }
    }

    for record_id in &policy.pinned_record_ids {
        protected_record_ids.insert(record_id.clone());
    }

    if policy.keep_unresolved_attention.unwrap_or(true) {
        for record in &records {
            if record.record_type == "attention_item" && is_unresolved_attention(&record.value) {
                protected_record_ids.insert(record.record_id.clone());
            }
        }
    }

    let removed_records: Vec<NativeStoreRecord> = records
        .iter()
        .filter(|record| should_prune_record(record, policy, &protected_record_ids))
        .cloned()
        .collect();

    for record in &removed_records {
        store.connection.execute(
            "DELETE FROM masthead_records WHERE record_id = ?1",
            params![&record.record_id],
        )?;
    }

    let removed_by_type = count_records_by_type(&removed_records);
    let removed_record_ids = removed_records
        .iter()
        .map(|record| record.record_id.clone())
        .collect::<Vec<_>>();

    Ok(PruneLocalDataResult {
        removed_records: removed_records.len(),
        removed_record_ids,
        removed_by_type,
        retained_records: records.len().saturating_sub(removed_records.len()),
        touched_external_state: false,
    })
}

#[tauri::command]
pub fn append_store_records_command(app: AppHandle, records: Vec<NativeStoreRecord>) -> Result<(), String> {
    let store = open_native_store(app_store_path(&app)?).map_err(error_string)?;
    write_native_records(&store, &records).map_err(error_string)
}

#[tauri::command]
pub fn read_store_records_command(app: AppHandle) -> Result<Vec<NativeStoreRecord>, String> {
    let store = open_native_store(app_store_path(&app)?).map_err(error_string)?;
    read_native_records(&store).map_err(error_string)
}

#[tauri::command]
pub fn clear_local_data_command(app: AppHandle) -> Result<ClearLocalDataResult, String> {
    let store = open_native_store(app_store_path(&app)?).map_err(error_string)?;
    clear_native_store(&store).map_err(error_string)
}

#[tauri::command]
pub fn prune_local_data_command(app: AppHandle, policy: RetentionPolicy) -> Result<PruneLocalDataResult, String> {
    let store = open_native_store(app_store_path(&app)?).map_err(error_string)?;
    prune_native_records(&store, &policy).map_err(error_string)
}

#[tauri::command]
pub fn export_store_records_command(app: AppHandle, exported_at: String) -> Result<String, String> {
    let store = open_native_store(app_store_path(&app)?).map_err(error_string)?;
    export_native_records(&store, &exported_at).map_err(error_string)
}

fn app_store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(error_string)?;
    fs::create_dir_all(&directory).map_err(error_string)?;
    Ok(directory.join("masthead.sqlite"))
}

fn error_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn should_prune_record(record: &NativeStoreRecord, policy: &RetentionPolicy, protected_record_ids: &HashSet<String>) -> bool {
    if protected_record_ids.contains(&record.record_id) {
        return false;
    }
    if !matches_retention_type(record, policy) {
        return false;
    }
    let older_than_cutoff = policy
        .cutoff_at
        .as_ref()
        .map_or(false, |cutoff_at| record.observed_at.as_str() < cutoff_at.as_str());
    let beyond_latest_cap = policy.keep_latest.is_some() && !protected_record_ids.contains(&record.record_id);
    older_than_cutoff || beyond_latest_cap
}

fn matches_retention_type(record: &NativeStoreRecord, policy: &RetentionPolicy) -> bool {
    policy.record_types.is_empty() || policy.record_types.contains(&record.record_type)
}

fn is_unresolved_attention(value: &Value) -> bool {
    !has_json_value(value, "resolvedAt") && !has_json_value(value, "dismissedAt")
}

fn has_json_value(value: &Value, key: &str) -> bool {
    match value.get(key) {
        Some(Value::Null) | None => false,
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

fn count_records_by_type(records: &[NativeStoreRecord]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for record in records {
        *counts.entry(record.record_type.clone()).or_insert(0) += 1;
    }
    counts
}
