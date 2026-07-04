CREATE INDEX IF NOT EXISTS tool_results_tool_call_completed_idx
  ON tool_results(tool_call_id, completed_at DESC, tool_result_id DESC);

CREATE INDEX IF NOT EXISTS tool_results_session_status_idx
  ON tool_results(session_id, status);

CREATE INDEX IF NOT EXISTS runtime_signals_session_observed_idx
  ON runtime_signals(session_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS checkpoints_session_observed_idx
  ON checkpoints(session_id, observed_at DESC);
