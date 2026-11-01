PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS monitor_jobs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
 params_json TEXT NOT NULL, interval_seconds INTEGER NOT NULL CHECK(interval_seconds >= 300),
 enabled INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, paid_daily_budget INTEGER NOT NULL DEFAULT 0,
 paid_day TEXT, paid_used INTEGER NOT NULL DEFAULT 0,
 next_due INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1, last_hash TEXT, last_snapshot_json TEXT,
 last_checked INTEGER, last_changed INTEGER, failures INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS monitor_jobs_due ON monitor_jobs(enabled,next_due,lease_until);
CREATE INDEX IF NOT EXISTS monitor_jobs_owner ON monitor_jobs(user_id,created_at);
CREATE TABLE IF NOT EXISTS monitor_checks (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES monitor_jobs(id), user_id TEXT NOT NULL,
 attempt_key TEXT NOT NULL UNIQUE, observed_at INTEGER NOT NULL, state TEXT NOT NULL,
 content_hash TEXT, source TEXT, snapshot_json TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS monitor_checks_owner ON monitor_checks(user_id,job_id,observed_at);
CREATE TABLE IF NOT EXISTS monitor_alerts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, job_id TEXT, rule_id TEXT,
 event_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, message TEXT NOT NULL,
 evidence_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 received_at INTEGER, read_at INTEGER
);
CREATE INDEX IF NOT EXISTS monitor_alerts_owner ON monitor_alerts(user_id,created_at,read_at);
CREATE TABLE IF NOT EXISTS position_feeds (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1,
 last_observed_at INTEGER, last_latitude REAL, last_longitude REAL, last_accuracy REAL,
 last_received_at INTEGER, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS position_feeds_owner ON position_feeds(user_id);
CREATE TABLE IF NOT EXISTS geofence_rules (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, feed_id TEXT NOT NULL REFERENCES position_feeds(id),
 label TEXT NOT NULL, entity_label TEXT NOT NULL, polygon_json TEXT NOT NULL,
 max_accuracy_m REAL NOT NULL DEFAULT 100, boundary_rule TEXT NOT NULL DEFAULT 'inside',
 enabled INTEGER NOT NULL DEFAULT 1, last_state TEXT, last_observed_at INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS geofence_rules_feed ON geofence_rules(feed_id,enabled,user_id);
CREATE TABLE IF NOT EXISTS position_receipts (
 feed_id TEXT NOT NULL REFERENCES position_feeds(id), event_id TEXT NOT NULL,
 user_id TEXT NOT NULL, observed_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
 payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(feed_id,event_id)
);
CREATE TABLE IF NOT EXISTS scheduler_ticks (
 scheduled_at INTEGER PRIMARY KEY, started_at INTEGER NOT NULL, completed_at INTEGER,
 checked INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0
);
