CREATE TABLE session_transcript_fingerprints (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_session_transcript_fingerprints_lookup
  ON session_transcript_fingerprints(fingerprint, session_id);

CREATE TRIGGER invalidate_message_transcript_fingerprint_after_insert
AFTER INSERT ON messages BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = NEW.session_id;
END;
CREATE TRIGGER invalidate_message_transcript_fingerprint_after_update
AFTER UPDATE ON messages BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id IN (OLD.session_id, NEW.session_id);
END;
CREATE TRIGGER invalidate_message_transcript_fingerprint_after_delete
AFTER DELETE ON messages BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = OLD.session_id;
END;

CREATE TRIGGER invalidate_tool_call_transcript_fingerprint_after_insert
AFTER INSERT ON tool_calls BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = NEW.session_id;
END;
CREATE TRIGGER invalidate_tool_call_transcript_fingerprint_after_update
AFTER UPDATE ON tool_calls BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id IN (OLD.session_id, NEW.session_id);
END;
CREATE TRIGGER invalidate_tool_call_transcript_fingerprint_after_delete
AFTER DELETE ON tool_calls BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = OLD.session_id;
END;

CREATE TRIGGER invalidate_tool_result_transcript_fingerprint_after_insert
AFTER INSERT ON tool_results BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = NEW.session_id;
END;
CREATE TRIGGER invalidate_tool_result_transcript_fingerprint_after_update
AFTER UPDATE ON tool_results BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id IN (OLD.session_id, NEW.session_id);
END;
CREATE TRIGGER invalidate_tool_result_transcript_fingerprint_after_delete
AFTER DELETE ON tool_results BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = OLD.session_id;
END;

CREATE TRIGGER invalidate_checkpoint_transcript_fingerprint_after_insert
AFTER INSERT ON checkpoints BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = NEW.session_id;
END;
CREATE TRIGGER invalidate_checkpoint_transcript_fingerprint_after_update
AFTER UPDATE ON checkpoints BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id IN (OLD.session_id, NEW.session_id);
END;
CREATE TRIGGER invalidate_checkpoint_transcript_fingerprint_after_delete
AFTER DELETE ON checkpoints BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = OLD.session_id;
END;

CREATE TRIGGER invalidate_runtime_signal_transcript_fingerprint_after_insert
AFTER INSERT ON runtime_signals BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = NEW.session_id;
END;
CREATE TRIGGER invalidate_runtime_signal_transcript_fingerprint_after_update
AFTER UPDATE ON runtime_signals BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id IN (OLD.session_id, NEW.session_id);
END;
CREATE TRIGGER invalidate_runtime_signal_transcript_fingerprint_after_delete
AFTER DELETE ON runtime_signals BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = OLD.session_id;
END;

CREATE TRIGGER invalidate_file_effect_transcript_fingerprint_after_insert
AFTER INSERT ON file_effects BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = NEW.session_id;
END;
CREATE TRIGGER invalidate_file_effect_transcript_fingerprint_after_update
AFTER UPDATE ON file_effects BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id IN (OLD.session_id, NEW.session_id);
END;
CREATE TRIGGER invalidate_file_effect_transcript_fingerprint_after_delete
AFTER DELETE ON file_effects BEGIN
  DELETE FROM session_transcript_fingerprints WHERE session_id = OLD.session_id;
END;
