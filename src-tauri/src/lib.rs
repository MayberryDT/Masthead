pub mod native_store;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            native_store::append_store_records_command,
            native_store::read_store_records_command,
            native_store::clear_local_data_command,
            native_store::prune_local_data_command,
            native_store::export_store_records_command
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Masthead Tauri shell");
}

#[cfg(test)]
mod native_store_tests {
    use crate::native_store::{
        clear_native_store, export_native_records, open_native_store, prune_native_records, read_native_records,
        write_native_records, NativeStoreRecord, RetentionPolicy,
    };
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn persists_records_across_reopen() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("masthead.sqlite");
        let first = NativeStoreRecord {
            record_id: "record:event:1".to_string(),
            record_type: "event".to_string(),
            observed_at: "2026-06-23T04:00:00.000Z".to_string(),
            value: json!({ "eventId": "event-1", "summary": "Session started" }),
        };
        let second = NativeStoreRecord {
            record_id: "record:attention:1".to_string(),
            record_type: "attention_item".to_string(),
            observed_at: "2026-06-23T04:00:01.000Z".to_string(),
            value: json!({ "itemId": "attention-1", "title": "Needs review" }),
        };

        {
            let store = open_native_store(&db_path).expect("open first");
            write_native_records(&store, &[first.clone(), second.clone()]).expect("write records");
        }

        let reopened = open_native_store(&db_path).expect("open second");
        let records = read_native_records(&reopened).expect("read records");

        assert_eq!(records, vec![first, second]);
    }

    #[test]
    fn persists_review_disposition_metadata_across_reopen() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("masthead.sqlite");
        let disposition = NativeStoreRecord {
            record_id: "record:review_disposition:review-session-1".to_string(),
            record_type: "review_disposition".to_string(),
            observed_at: "2026-06-23T05:30:00.000Z".to_string(),
            value: json!({
                "dispositionId": "review-session-1",
                "subjectId": "session-1",
                "subjectType": "session",
                "status": "snoozed",
                "recordedAt": "2026-06-23T05:30:00.000Z",
                "snoozedUntil": "2026-06-23T06:30:00.000Z",
                "reason": "Snoozed from Masthead board."
            }),
        };

        {
            let store = open_native_store(&db_path).expect("open first");
            write_native_records(&store, &[disposition.clone()]).expect("write disposition");
        }

        let reopened = open_native_store(&db_path).expect("open second");
        let records = read_native_records(&reopened).expect("read records");

        assert_eq!(records, vec![disposition]);
        assert_eq!(records[0].value["snoozedUntil"], "2026-06-23T06:30:00.000Z");
    }

    #[test]
    fn exports_records_with_masthead_metadata() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("masthead.sqlite");
        let store = open_native_store(&db_path).expect("open");
        write_native_records(
            &store,
            &[NativeStoreRecord {
                record_id: "record:event:1".to_string(),
                record_type: "event".to_string(),
                observed_at: "2026-06-23T04:00:00.000Z".to_string(),
                value: json!({ "eventId": "event-1" }),
            }],
        )
        .expect("write");

        let exported = export_native_records(&store, "2026-06-23T04:05:00.000Z").expect("export");
        let parsed: serde_json::Value = serde_json::from_str(&exported).expect("valid json");

        assert_eq!(parsed["metadata"]["format"], "masthead.native-store.v1");
        assert_eq!(parsed["metadata"]["recordCount"], 1);
        assert_eq!(parsed["records"][0]["recordId"], "record:event:1");
    }

    #[test]
    fn clear_removes_only_masthead_local_records() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("masthead.sqlite");
        let store = open_native_store(&db_path).expect("open");
        write_native_records(
            &store,
            &[NativeStoreRecord {
                record_id: "record:event:1".to_string(),
                record_type: "event".to_string(),
                observed_at: "2026-06-23T04:00:00.000Z".to_string(),
                value: json!({ "eventId": "event-1" }),
            }],
        )
        .expect("write");

        let result = clear_native_store(&store).expect("clear");

        assert_eq!(result.removed_records, 1);
        assert!(!result.touched_external_state);
        assert_eq!(read_native_records(&store).expect("read after clear"), Vec::<NativeStoreRecord>::new());
    }

    #[test]
    fn prunes_expired_local_records_but_preserves_pinned_and_unresolved_attention() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("masthead.sqlite");
        let store = open_native_store(&db_path).expect("open");
        let old_event = NativeStoreRecord {
            record_id: "record:event:old".to_string(),
            record_type: "event".to_string(),
            observed_at: "2026-05-01T00:00:00.000Z".to_string(),
            value: json!({ "eventId": "old-event" }),
        };
        let pinned_old_event = NativeStoreRecord {
            record_id: "record:event:pinned".to_string(),
            record_type: "event".to_string(),
            observed_at: "2026-05-02T00:00:00.000Z".to_string(),
            value: json!({ "eventId": "pinned-event" }),
        };
        let unresolved_attention = NativeStoreRecord {
            record_id: "record:attention_item:unresolved".to_string(),
            record_type: "attention_item".to_string(),
            observed_at: "2026-05-03T00:00:00.000Z".to_string(),
            value: json!({ "itemId": "attention-1", "sessionId": "session-1" }),
        };
        let recent_snapshot = NativeStoreRecord {
            record_id: "record:git_snapshot:recent".to_string(),
            record_type: "git_snapshot".to_string(),
            observed_at: "2026-06-20T00:00:00.000Z".to_string(),
            value: json!({ "snapshotId": "recent-snapshot" }),
        };

        write_native_records(
            &store,
            &[
                old_event.clone(),
                pinned_old_event.clone(),
                unresolved_attention.clone(),
                recent_snapshot.clone(),
            ],
        )
        .expect("write");

        let result = prune_native_records(
            &store,
            &RetentionPolicy {
                cutoff_at: Some("2026-06-01T00:00:00.000Z".to_string()),
                keep_latest: None,
                record_types: vec!["event".to_string(), "git_snapshot".to_string(), "attention_item".to_string()],
                pinned_record_ids: vec![pinned_old_event.record_id.clone()],
                keep_unresolved_attention: Some(true),
            },
        )
        .expect("prune");

        assert_eq!(result.removed_records, 1);
        assert_eq!(result.removed_record_ids, vec![old_event.record_id]);
        assert_eq!(result.removed_by_type.get("event"), Some(&1));
        assert_eq!(result.retained_records, 3);
        assert!(!result.touched_external_state);
        assert_eq!(
            read_native_records(&store).expect("read after prune"),
            vec![pinned_old_event, unresolved_attention, recent_snapshot]
        );
    }
}
