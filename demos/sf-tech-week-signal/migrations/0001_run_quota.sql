CREATE TABLE IF NOT EXISTS sf_signal_runs (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  quota_day TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  total_events INTEGER NOT NULL,
  processed_events INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_latency_ms INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sf_signal_runs_ip_day_idx
  ON sf_signal_runs (ip_hash, quota_day);
